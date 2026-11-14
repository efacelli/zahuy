-- Paso E: lotes, movimientos de stock (append-only) y auditoría.
-- Contrato: docs/DATA_CONTRACT.md v0.3.1, secciones 3, 5.5, 5.6, 5.7, 5.8 y 9.
--
-- Migración solo aditiva: crea tablas y triggers nuevos; no modifica datos
-- existentes. La auditoría empieza a registrar desde que se aplica.
--
-- Fuente única de verdad del stock (contrato §3):
--   * stock_movements es el ledger: no se actualiza ni se borra.
--   * product_batches.quantity_available es el único saldo materializado.
--   * El stock del producto no se guarda: es la suma de sus lotes (vistas).
-- Ningún rol de la app escribe estas dos tablas de forma directa: solo las
-- RPC del paso G.

-- ---------------------------------------------------------------------------
-- 1. Funciones comunes
-- ---------------------------------------------------------------------------
-- Rechaza UPDATE, DELETE y TRUNCATE en tablas de solo agregado. Vale para
-- cualquier rol, incluidos los privilegiados: corregir un movimiento se hace
-- con otro movimiento, nunca editando el historial.
create function private.reject_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'APPEND_ONLY: % no admite %', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

revoke all on function private.reject_modification() from public;

-- ---------------------------------------------------------------------------
-- 2. product_batches (contrato §5.6)
-- ---------------------------------------------------------------------------
create table public.product_batches (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  batch_number text,
  received_on date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  expires_on date,
  quantity_initial numeric(12, 3) not null,
  quantity_available numeric(12, 3) not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint product_batches_pkey primary key (id),
  -- Destino de la FK compuesta de stock_movements: el lote pertenece al producto.
  constraint product_batches_id_product_id_key unique (id, product_id),
  constraint product_batches_quantity_initial_check check (quantity_initial > 0),
  constraint product_batches_quantity_available_check check (quantity_available >= 0),
  constraint product_batches_product_id_fkey foreign key (product_id) references public.products (id) on delete restrict,
  constraint product_batches_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint product_batches_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.product_batches is
  'Lotes. Todo stock pertenece a un lote; los no perecederos usan expires_on nulo.';
comment on column public.product_batches.quantity_available is
  'Único saldo materializado. Solo lo modifican las RPC, junto con su movimiento.';

create index product_batches_product_id_idx on public.product_batches (product_id);
create index product_batches_expires_on_idx on public.product_batches (expires_on)
  where quantity_available > 0 and expires_on is not null;

-- product_id y quantity_initial no cambian nunca, para ningún rol.
create function private.product_batches_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is distinct from old.product_id then
    raise exception 'product_batches.product_id no se puede modificar'
      using errcode = '23514';
  end if;
  if new.quantity_initial is distinct from old.quantity_initial then
    raise exception 'product_batches.quantity_initial no se puede modificar'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.product_batches_before_update() from public;

create trigger product_batches_before_update
  before update on public.product_batches
  for each row
  execute function private.product_batches_before_update();

create trigger product_batches_set_audit_columns
  before insert or update on public.product_batches
  for each row
  execute function private.set_audit_columns();

alter table public.product_batches enable row level security;

-- ---------------------------------------------------------------------------
-- 3. stock_movements (contrato §5.7)
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  product_id uuid not null,
  batch_id uuid not null,
  movement_type public.movement_type not null,
  quantity numeric(12, 3) not null,
  -- El signo sale del tipo: la cantidad siempre es positiva.
  signed_quantity numeric(12, 3) generated always as (
    case
      when movement_type in (
        'entry'::public.movement_type,
        'adjustment_in'::public.movement_type,
        'customer_return'::public.movement_type
      ) then quantity
      else -quantity
    end
  ) stored,
  batch_quantity_after numeric(12, 3) not null,
  reason text,
  notes text,
  reverses_movement_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  constraint stock_movements_pkey primary key (id),
  constraint stock_movements_idempotency_key_key unique (idempotency_key),
  constraint stock_movements_reverses_movement_id_key unique (reverses_movement_id),
  constraint stock_movements_quantity_check check (quantity > 0),
  constraint stock_movements_batch_quantity_after_check check (batch_quantity_after >= 0),
  -- Motivo obligatorio (no vacío) para todo tipo salvo entry y exit.
  constraint stock_movements_reason_check check (
    movement_type in ('entry'::public.movement_type, 'exit'::public.movement_type)
    or coalesce(length(trim(reason)), 0) > 0
  ),
  -- El lote pertenece al producto: lo garantiza la base.
  constraint stock_movements_batch_product_fkey foreign key (batch_id, product_id)
    references public.product_batches (id, product_id) on delete restrict,
  constraint stock_movements_reverses_movement_id_fkey foreign key (reverses_movement_id)
    references public.stock_movements (id) on delete restrict,
  constraint stock_movements_created_by_fkey foreign key (created_by)
    references public.profiles (id) on delete restrict
);

comment on table public.stock_movements is
  'Ledger de stock, append-only. Se corrige con movimientos compensatorios, nunca editando.';

create index stock_movements_product_id_occurred_at_idx on public.stock_movements (product_id, occurred_at desc);
create index stock_movements_batch_id_idx on public.stock_movements (batch_id);
create index stock_movements_created_by_idx on public.stock_movements (created_by);

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row
  execute function private.reject_modification();

create trigger stock_movements_no_truncate
  before truncate on public.stock_movements
  for each statement
  execute function private.reject_modification();

alter table public.stock_movements enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Conciliación garantizada por la base (contrato §3)
-- ---------------------------------------------------------------------------
-- Al confirmar cada transacción, el saldo del lote tiene que coincidir con la
-- suma de sus movimientos. Es diferida para que una RPC pueda crear el lote y
-- su movimiento en cualquier orden dentro de la misma transacción.
create function private.assert_batch_matches_ledger(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available numeric;
  v_ledger numeric;
begin
  select b.quantity_available into v_available
  from public.product_batches b
  where b.id = p_batch_id;

  select coalesce(sum(m.signed_quantity), 0) into v_ledger
  from public.stock_movements m
  where m.batch_id = p_batch_id;

  if v_available is distinct from v_ledger then
    raise exception 'LEDGER_MISMATCH: el saldo del lote % es % y sus movimientos suman %',
      p_batch_id, v_available, v_ledger
      using errcode = '23514';
  end if;
end;
$$;

create function private.check_ledger_from_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_batch_matches_ledger(new.batch_id);
  return null;
end;
$$;

create function private.check_ledger_from_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_batch_matches_ledger(new.id);
  return null;
end;
$$;

revoke all on function private.assert_batch_matches_ledger(uuid) from public;
revoke all on function private.check_ledger_from_movement() from public;
revoke all on function private.check_ledger_from_batch() from public;

create constraint trigger stock_movements_ledger_check
  after insert on public.stock_movements
  deferrable initially deferred
  for each row
  execute function private.check_ledger_from_movement();

create constraint trigger product_batches_ledger_check
  after insert or update of quantity_available on public.product_batches
  deferrable initially deferred
  for each row
  execute function private.check_ledger_from_batch();

-- ---------------------------------------------------------------------------
-- 5. La unidad de venta no cambia si el producto tiene movimientos (§5.5)
-- ---------------------------------------------------------------------------
-- Pasar de kg a unit con stock fraccionario rompería la regla de enteros.
create function private.products_block_sale_unit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.stock_movements m where m.product_id = old.id) then
    raise exception 'products.sale_unit no se puede cambiar: el producto tiene movimientos'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.products_block_sale_unit_change() from public;

create trigger products_block_sale_unit_change
  before update of sale_unit on public.products
  for each row
  when (new.sale_unit is distinct from old.sale_unit)
  execute function private.products_block_sale_unit_change();

-- ---------------------------------------------------------------------------
-- 6. audit_log (contrato §5.8)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity,
  table_name text not null,
  record_id uuid not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  constraint audit_log_pkey primary key (id),
  constraint audit_log_action_check check (action in ('insert', 'update'))
);

comment on table public.audit_log is
  'Cambios en tablas editables. Lo escriben triggers; solo lo lee un admin.';

create index audit_log_record_idx on public.audit_log (table_name, record_id, changed_at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row
  execute function private.reject_modification();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement
  execute function private.reject_modification();

alter table public.audit_log enable row level security;

-- Registra altas y ediciones. Una edición que no cambia ningún dato (más allá
-- de updated_at / updated_by) no genera fila.
create function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
      return null;
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, new.id, lower(tg_op), v_old, v_new, (select auth.uid()));
  return null;
end;
$$;

revoke all on function private.write_audit_log() from public;

create trigger profiles_audit
  after insert or update on public.profiles
  for each row execute function private.write_audit_log();
create trigger categories_audit
  after insert or update on public.categories
  for each row execute function private.write_audit_log();
create trigger brands_audit
  after insert or update on public.brands
  for each row execute function private.write_audit_log();
create trigger suppliers_audit
  after insert or update on public.suppliers
  for each row execute function private.write_audit_log();
create trigger products_audit
  after insert or update on public.products
  for each row execute function private.write_audit_log();

-- En lotes solo se auditan los datos editables: los cambios de saldo ya están
-- en stock_movements.
create trigger product_batches_audit
  after update on public.product_batches
  for each row
  when (
    old.batch_number is distinct from new.batch_number
    or old.expires_on is distinct from new.expires_on
    or old.notes is distinct from new.notes
  )
  execute function private.write_audit_log();

-- ---------------------------------------------------------------------------
-- 7. Permisos y políticas (contrato §9)
-- ---------------------------------------------------------------------------
revoke all on table public.product_batches, public.stock_movements, public.audit_log
  from public, anon, authenticated;

grant select on table public.product_batches, public.stock_movements, public.audit_log to authenticated;

-- Lotes: sin INSERT ni DELETE; edición directa solo de tres columnas.
grant update (batch_number, expires_on, notes) on table public.product_batches to authenticated;

create policy product_batches_select on public.product_batches
  for select to authenticated
  using ((select private.is_active_user()));

create policy product_batches_update on public.product_batches
  for update to authenticated
  using ((select private.can_manage_inventory()))
  with check ((select private.can_manage_inventory()));

-- Movimientos: solo lectura. Se escriben únicamente por RPC.
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using ((select private.is_active_user()));

-- Auditoría: solo la lee un admin; nadie la escribe desde la app.
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using ((select private.is_admin()));
