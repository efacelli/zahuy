-- Facturación electrónica ARCA, capa de base de datos (contrato v0.12.0, §22).
--
-- Migración ADITIVA: tablas nuevas, ninguna existente se modifica salvo un trigger nuevo sobre sales
-- que impide anular una venta con factura autorizada sin nota de crédito. Con fiscal_settings.environment
-- en 'off' (valor por defecto) NO existe ningún documento fiscal y la caja se comporta exactamente
-- igual que antes. No habla con ARCA: eso lo hace la Edge Function con la service_role.
--
-- * fiscal_settings: ambiente (off / homologacion / produccion) y punto de venta. El CUIT NO va en la base.
-- * fiscal_documents: un comprobante por fila, inmutable una vez autorizado o rechazado.
-- * private.fiscal_tickets: ticket de acceso (WSAA). ARCA no entrega otro mientras el anterior siga vigente,
--   por eso se guarda acá y no en la memoria de la función. Fuera del esquema expuesto: solo RPC de la service_role.
-- * fiscal_begin / fiscal_finish: reservan el número bajo bloqueo y cierran el documento. Solo service_role.

-- ---------------------------------------------------------------------------
-- 1. fiscal_settings (una sola fila)
-- ---------------------------------------------------------------------------
create table public.fiscal_settings (
  id uuid not null default gen_random_uuid(),
  environment text not null default 'off',
  pto_vta integer,
  caea_pto_vta integer,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint fiscal_settings_pkey primary key (id),
  constraint fiscal_settings_environment_check check (environment in ('off', 'homologacion', 'produccion')),
  constraint fiscal_settings_pto_vta_check check (pto_vta is null or pto_vta between 1 and 99998),
  constraint fiscal_settings_caea_pto_vta_check check (
    caea_pto_vta is null or (caea_pto_vta between 1 and 99998 and caea_pto_vta is distinct from pto_vta)
  ),
  constraint fiscal_settings_env_needs_pto_vta check (environment = 'off' or pto_vta is not null),
  constraint fiscal_settings_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint fiscal_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.fiscal_settings is
  'Configuración fiscal (una sola fila). environment = off por defecto: la caja emite solo el ticket interno. El CUIT es un secreto de la función, no se guarda acá (contrato §22.2).';

create unique index fiscal_settings_singleton_key on public.fiscal_settings ((true));

create trigger fiscal_settings_no_delete
  before delete on public.fiscal_settings
  for each row execute function private.reject_modification();
create trigger fiscal_settings_set_audit_columns
  before insert or update on public.fiscal_settings
  for each row execute function private.set_audit_columns();
create trigger fiscal_settings_audit
  after insert or update on public.fiscal_settings
  for each row execute function private.write_audit_log();

-- No se puede pasar a producción sin haber autorizado antes al menos un comprobante en homologación.
create function private.fiscal_settings_guard_production()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.environment = 'produccion' and old.environment is distinct from 'produccion' then
    if not exists (
      select 1 from public.fiscal_documents d where d.environment = 'homologacion' and d.status = 'authorized'
    ) then
      perform private.raise_business_error('PRODUCTION_NOT_READY');
    end if;
  end if;
  return new;
end;
$$;

alter table public.fiscal_settings enable row level security;

revoke all on table public.fiscal_settings from public, anon, authenticated;
grant select on table public.fiscal_settings to authenticated;
grant update (environment, pto_vta, caea_pto_vta) on table public.fiscal_settings to authenticated;

create policy fiscal_settings_select on public.fiscal_settings
  for select to authenticated using ((select private.is_active_user()));
create policy fiscal_settings_update on public.fiscal_settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

insert into public.fiscal_settings (environment) values ('off');

-- ---------------------------------------------------------------------------
-- 2. fiscal_documents
-- ---------------------------------------------------------------------------
create table public.fiscal_documents (
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  kind text not null,
  original_document_id uuid,
  cbte_tipo smallint not null,
  pto_vta integer not null,
  -- El número se reserva al empezar (fiscal_begin) bajo bloqueo; el contrato lo dejaba nulo hasta obtenerlo.
  cbte_nro bigint not null,
  environment text not null,
  status text not null default 'pending',
  authorization_kind text not null default 'CAE',
  cae text,
  cae_expires_on date,
  receiver_doc_type smallint not null default 99,
  receiver_doc_number text not null default '0',
  receiver_vat_condition_id smallint not null default 5,
  imp_total numeric(12, 2) not null,
  imp_neto numeric(12, 2) not null,
  imp_iva numeric(12, 2) not null,
  iva_breakdown jsonb not null,
  request_payload jsonb,
  response_payload jsonb,
  observations jsonb not null default '[]'::jsonb,
  idempotency_key uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  authorized_at timestamptz,
  constraint fiscal_documents_pkey primary key (id),
  constraint fiscal_documents_idempotency_key_key unique (idempotency_key),
  constraint fiscal_documents_sale_id_fkey foreign key (sale_id) references public.sales (id) on delete restrict,
  constraint fiscal_documents_original_fkey foreign key (original_document_id) references public.fiscal_documents (id) on delete restrict,
  constraint fiscal_documents_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint fiscal_documents_kind_check check (kind in ('invoice', 'credit_note')),
  constraint fiscal_documents_status_check check (status in ('pending', 'authorized', 'rejected', 'unknown')),
  constraint fiscal_documents_environment_check check (environment in ('homologacion', 'produccion')),
  constraint fiscal_documents_authorization_kind_check check (authorization_kind in ('CAE', 'CAEA')),
  -- Factura A o B, y sus notas de crédito A o B (contrato §22.2). Una nota de crédito apunta a su factura.
  constraint fiscal_documents_kind_type_check check (
    (kind = 'invoice' and cbte_tipo in (1, 6) and original_document_id is null)
    or (kind = 'credit_note' and cbte_tipo in (3, 8) and original_document_id is not null)
  ),
  constraint fiscal_documents_pto_vta_check check (pto_vta between 1 and 99998),
  constraint fiscal_documents_cbte_nro_check check (cbte_nro >= 1),
  constraint fiscal_documents_receiver_check check (
    receiver_doc_type >= 0 and receiver_doc_number ~ '^[0-9]{1,20}$'
    and (receiver_doc_type <> 99 or receiver_doc_number = '0')
  ),
  constraint fiscal_documents_amounts_check check (
    imp_total > 0 and imp_neto >= 0 and imp_iva >= 0 and imp_neto + imp_iva = imp_total
  ),
  constraint fiscal_documents_authorized_check check (
    (status = 'authorized' and cae ~ '^[0-9]{14}$' and cae_expires_on is not null and authorized_at is not null)
    or (status <> 'authorized' and cae is null and cae_expires_on is null and authorized_at is null)
  ),
  -- Nunca se guarda un token ni una firma de ARCA en el documento.
  constraint fiscal_documents_no_secrets_check check (
    (request_payload is null or not (request_payload ?| array['token', 'sign', 'Token', 'Sign']))
    and (response_payload is null or not (response_payload ?| array['token', 'sign', 'Token', 'Sign']))
  )
);

comment on table public.fiscal_documents is
  'Comprobantes fiscales (contrato §22.2). Solo los escribe la función con service_role. Autorizado o rechazado = inmutable; no se borra nunca.';

-- Una venta tiene a lo sumo una factura (y una nota de crédito) viva.
create unique index fiscal_documents_live_sale_kind_key
  on public.fiscal_documents (sale_id, kind) where status in ('pending', 'authorized', 'unknown');
-- Un número de comprobante no se repite en un mismo ambiente, punto de venta y tipo. Un documento rechazado no
-- consumió el número en ARCA: ese número se puede volver a usar.
create unique index fiscal_documents_number_key
  on public.fiscal_documents (environment, pto_vta, cbte_tipo, cbte_nro) where status <> 'rejected';
create index fiscal_documents_sale_id_idx on public.fiscal_documents (sale_id);

-- Al crear: estado inicial, ambiente vigente e importes iguales a los de la venta (contrato §22.4).
create function private.fiscal_documents_check_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_env text;
  v_sale public.sales;
  v_original public.fiscal_documents;
begin
  if new.status <> 'pending' then
    perform private.raise_business_error('INVALID_FISCAL_DOCUMENT');
  end if;
  select environment into v_env from public.fiscal_settings;
  if v_env is null or v_env = 'off' or new.environment <> v_env then
    perform private.raise_business_error('FISCAL_DISABLED');
  end if;
  select * into v_sale from public.sales where id = new.sale_id;
  if not found then
    perform private.raise_business_error('SALE_NOT_FOUND');
  end if;
  if new.imp_total <> v_sale.total_amount or new.imp_neto <> v_sale.net_amount or new.imp_iva <> v_sale.vat_amount then
    perform private.raise_business_error('FISCAL_AMOUNT_MISMATCH');
  end if;
  if new.kind = 'invoice' and v_sale.status <> 'completed' then
    perform private.raise_business_error('SALE_VOIDED');
  end if;
  if new.kind = 'credit_note' then
    select * into v_original from public.fiscal_documents where id = new.original_document_id;
    if not found or v_original.kind <> 'invoice' or v_original.status <> 'authorized'
       or v_original.sale_id <> new.sale_id or v_original.environment <> new.environment
       or v_original.pto_vta <> new.pto_vta or new.cbte_tipo <> v_original.cbte_tipo + 2 then
      perform private.raise_business_error('INVALID_FISCAL_DOCUMENT');
    end if;
  end if;
  return new;
end;
$$;

-- Al actualizar: solo avanza de estado y solo cambian los campos de la respuesta de ARCA.
create function private.fiscal_documents_check_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changing text[] := array['status', 'cae', 'cae_expires_on', 'request_payload', 'response_payload', 'observations', 'authorized_at'];
begin
  if old.status in ('authorized', 'rejected') then
    perform private.raise_business_error('FISCAL_DOCUMENT_IMMUTABLE');
  end if;
  if (to_jsonb(new) - v_changing) is distinct from (to_jsonb(old) - v_changing) then
    perform private.raise_business_error('FISCAL_DOCUMENT_IMMUTABLE');
  end if;
  if not ((old.status = 'pending' and new.status in ('authorized', 'rejected', 'unknown'))
       or (old.status = 'unknown' and new.status in ('authorized', 'rejected', 'unknown'))) then
    perform private.raise_business_error('INVALID_FISCAL_TRANSITION');
  end if;
  return new;
end;
$$;

create trigger fiscal_documents_check_insert
  before insert on public.fiscal_documents
  for each row execute function private.fiscal_documents_check_insert();
create trigger fiscal_documents_check_update
  before update on public.fiscal_documents
  for each row execute function private.fiscal_documents_check_update();
create trigger fiscal_documents_no_delete
  before delete on public.fiscal_documents
  for each row execute function private.reject_modification();
create trigger fiscal_documents_audit
  after insert or update on public.fiscal_documents
  for each row execute function private.write_audit_log();

create trigger fiscal_settings_guard_production
  before update on public.fiscal_settings
  for each row execute function private.fiscal_settings_guard_production();

alter table public.fiscal_documents enable row level security;

revoke all on table public.fiscal_documents from public, anon, authenticated;
grant select on table public.fiscal_documents to authenticated;

-- Encargado, dueño y programador ven todos; el empleado, solo los de las ventas que cobró.
create policy fiscal_documents_select on public.fiscal_documents
  for select to authenticated using (
    (select private.is_manager_or_admin())
    or (
      (select private.is_active_user())
      and exists (select 1 from public.sales s where s.id = fiscal_documents.sale_id and s.created_by = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Una venta con factura autorizada no se anula a secas (contrato §22.5)
-- ---------------------------------------------------------------------------
create function private.sales_block_void_with_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'voided' and old.status = 'completed' and exists (
    select 1 from public.fiscal_documents d
    where d.sale_id = new.id and d.kind = 'invoice' and d.status = 'authorized'
      and not exists (
        select 1 from public.fiscal_documents n
        where n.original_document_id = d.id and n.kind = 'credit_note' and n.status = 'authorized'
      )
  ) then
    perform private.raise_business_error('FISCAL_DOCUMENT_EXISTS');
  end if;
  return new;
end;
$$;

create trigger sales_block_void_with_invoice
  before update on public.sales
  for each row execute function private.sales_block_void_with_invoice();

-- ---------------------------------------------------------------------------
-- 4. Ticket de acceso de ARCA (WSAA): fuera del esquema expuesto
-- ---------------------------------------------------------------------------
create table private.fiscal_tickets (
  environment text not null,
  service text not null,
  token text not null,
  sign text not null,
  generation_time timestamptz not null,
  expiration_time timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint fiscal_tickets_pkey primary key (environment, service),
  constraint fiscal_tickets_environment_check check (environment in ('homologacion', 'produccion')),
  constraint fiscal_tickets_times_check check (expiration_time > generation_time)
);

comment on table private.fiscal_tickets is
  'Ticket de acceso del WSAA por ambiente y servicio. ARCA no entrega otro mientras este siga vigente (~12 h). Solo la service_role, por RPC.';

revoke all on table private.fiscal_tickets from public, anon, authenticated;

create function public.fiscal_ticket_get(p_environment text, p_service text)
returns table (token text, sign text, expiration_time timestamptz)
language sql
security definer
set search_path = ''
as $$
  select t.token, t.sign, t.expiration_time
  from private.fiscal_tickets t
  where t.environment = p_environment and t.service = p_service
    and t.expiration_time > now() + interval '2 minutes';
$$;

create function public.fiscal_ticket_save(
  p_environment text, p_service text, p_token text, p_sign text, p_generation_time timestamptz, p_expiration_time timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.fiscal_tickets (environment, service, token, sign, generation_time, expiration_time)
  values (p_environment, p_service, p_token, p_sign, p_generation_time, p_expiration_time)
  on conflict (environment, service) do update
    set token = excluded.token, sign = excluded.sign, generation_time = excluded.generation_time,
        expiration_time = excluded.expiration_time, updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- 5. fiscal_begin: reserva el número y deja el documento en pending
-- ---------------------------------------------------------------------------
create function public.fiscal_begin(
  p_idempotency_key uuid,
  p_sale_id uuid,
  p_kind text,
  p_cbte_tipo smallint,
  p_arca_last bigint,
  p_created_by uuid,
  p_receiver_doc_type smallint default 99,
  p_receiver_doc_number text default '0',
  p_receiver_vat_condition_id smallint default 5,
  p_original_document_id uuid default null
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.fiscal_settings;
  v_doc public.fiscal_documents;
  v_sale public.sales;
  v_breakdown jsonb;
  v_unsupported int;
  v_next bigint;
begin
  select * into v_settings from public.fiscal_settings;
  if v_settings.environment is null or v_settings.environment = 'off' then
    perform private.raise_business_error('FISCAL_DISABLED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);
  perform pg_advisory_xact_lock(
    hashtextextended('fiscal:' || v_settings.environment || ':' || v_settings.pto_vta || ':' || p_cbte_tipo, 0)
  );

  -- Reintento: misma clave y misma venta devuelve el documento ya creado.
  select * into v_doc from public.fiscal_documents where idempotency_key = p_idempotency_key;
  if found then
    if v_doc.sale_id = p_sale_id and v_doc.kind = p_kind then
      return v_doc;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  -- Si la venta ya tiene un comprobante vivo de ese tipo, se devuelve (se retoma, no se duplica).
  select * into v_doc from public.fiscal_documents
  where sale_id = p_sale_id and kind = p_kind and status in ('pending', 'authorized', 'unknown');
  if found then
    return v_doc;
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    perform private.raise_business_error('SALE_NOT_FOUND');
  end if;

  -- IVA por alícuota, tomado de los ítems de la venta (incluye las líneas libres).
  select count(*) filter (where i.vat_rate not in (10.50, 21.00)) into v_unsupported
  from public.sale_items i where i.sale_id = p_sale_id;
  if v_unsupported > 0 then
    perform private.raise_business_error('FISCAL_UNSUPPORTED_VAT');
  end if;
  select jsonb_agg(
           jsonb_build_object(
             'id', case when g.vat_rate = 10.50 then 4 else 5 end,
             'rate', g.vat_rate,
             'base', g.base,
             'amount', g.vat
           ) order by g.vat_rate
         )
    into v_breakdown
  from (
    select i.vat_rate, sum(i.net_amount) as base, sum(i.vat_amount) as vat
    from public.sale_items i where i.sale_id = p_sale_id group by i.vat_rate
  ) g;

  -- El número: lo que diga ARCA como último autorizado o lo ya reservado aquí (sin contar los rechazados), lo que
-- sea mayor, más uno.
  select greatest(coalesce(p_arca_last, 0), coalesce(max(d.cbte_nro), 0)) + 1 into v_next
  from public.fiscal_documents d
  where d.environment = v_settings.environment and d.pto_vta = v_settings.pto_vta and d.cbte_tipo = p_cbte_tipo
    and d.status <> 'rejected';

  insert into public.fiscal_documents (
    sale_id, kind, original_document_id, cbte_tipo, pto_vta, cbte_nro, environment,
    receiver_doc_type, receiver_doc_number, receiver_vat_condition_id,
    imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by
  )
  values (
    p_sale_id, p_kind, p_original_document_id, p_cbte_tipo, v_settings.pto_vta, v_next, v_settings.environment,
    coalesce(p_receiver_doc_type, 99), coalesce(p_receiver_doc_number, '0'), coalesce(p_receiver_vat_condition_id, 5),
    v_sale.total_amount, v_sale.net_amount, v_sale.vat_amount, v_breakdown, p_idempotency_key, p_created_by
  )
  returning * into v_doc;

  return v_doc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. fiscal_finish: cierra el documento con la respuesta de ARCA
-- ---------------------------------------------------------------------------
create function public.fiscal_finish(
  p_document_id uuid,
  p_status text,
  p_cae text default null,
  p_cae_expires_on date default null,
  p_request jsonb default null,
  p_response jsonb default null,
  p_observations jsonb default '[]'::jsonb
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.fiscal_documents;
begin
  if p_status not in ('authorized', 'rejected', 'unknown') then
    perform private.raise_business_error('INVALID_FISCAL_TRANSITION');
  end if;

  select * into v_doc from public.fiscal_documents where id = p_document_id for update;
  if not found then
    perform private.raise_business_error('INVALID_FISCAL_DOCUMENT');
  end if;

  update public.fiscal_documents
     set status = p_status,
         cae = case when p_status = 'authorized' then p_cae end,
         cae_expires_on = case when p_status = 'authorized' then p_cae_expires_on end,
         authorized_at = case when p_status = 'authorized' then now() end,
         request_payload = coalesce(p_request, request_payload),
         response_payload = coalesce(p_response, response_payload),
         observations = coalesce(p_observations, '[]'::jsonb)
   where id = p_document_id
   returning * into v_doc;

  return v_doc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permisos de las funciones: solo la service_role
-- ---------------------------------------------------------------------------
revoke all on function private.fiscal_settings_guard_production() from public;
revoke all on function private.fiscal_documents_check_insert() from public;
revoke all on function private.fiscal_documents_check_update() from public;
revoke all on function private.sales_block_void_with_invoice() from public;

revoke all on function public.fiscal_ticket_get(text, text) from public, anon, authenticated;
revoke all on function public.fiscal_ticket_save(text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fiscal_begin(uuid, uuid, text, smallint, bigint, uuid, smallint, text, smallint, uuid) from public, anon, authenticated;
revoke all on function public.fiscal_finish(uuid, text, text, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fiscal_ticket_get(text, text) to service_role;
grant execute on function public.fiscal_ticket_save(text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.fiscal_begin(uuid, uuid, text, smallint, bigint, uuid, smallint, text, smallint, uuid) to service_role;
grant execute on function public.fiscal_finish(uuid, text, text, date, jsonb, jsonb, jsonb) to service_role;

comment on function public.fiscal_begin(uuid, uuid, text, smallint, bigint, uuid, smallint, text, smallint, uuid) is
  'Reserva el número y crea el documento fiscal en pending (idempotente, serializado por ambiente, punto de venta y tipo). Solo service_role. Contrato §22.3.';
comment on function public.fiscal_finish(uuid, text, text, date, jsonb, jsonb, jsonb) is
  'Cierra el documento con la respuesta de ARCA (authorized, rejected o unknown). Solo service_role. Contrato §22.3.';
