-- Etapa 5 (ventas y caja), paso 3 de 5: sesiones de caja, ventas, ítems y pagos.
-- Contrato: docs/DATA_CONTRACT.md v0.6.1, §15.3.3 a §15.3.7 y §15.7.
--
-- Migración aditiva: crea cuatro tablas nuevas y agrega UNA columna nulable
-- (stock_movements.sale_item_id) con sus restricciones. Las filas existentes
-- de stock_movements quedan con sale_item_id nulo y cumplen el CHECK nuevo
-- (ninguna es de tipo `sale`).
--
-- Todas se escriben solo por RPC (migración siguiente): authenticated solo lee.
-- Ventas, ítems y pagos son inmutables; la única edición permitida es anular
-- una venta (completed -> voided) y cerrar una sesión de caja (open -> closed).

-- ---------------------------------------------------------------------------
-- 1. cash_sessions (§15.3.3)
-- ---------------------------------------------------------------------------
create table public.cash_sessions (
  id uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  cash_register_id uuid not null,
  status public.cash_session_status not null default 'open',
  opened_at timestamptz not null default now(),
  opened_by uuid not null default auth.uid(),
  opening_amount numeric(12, 2) not null,
  closed_at timestamptz,
  closed_by uuid,
  expected_cash numeric(12, 2),
  counted_cash numeric(12, 2),
  difference numeric(12, 2),
  close_notes text,
  created_at timestamptz not null default now(),
  constraint cash_sessions_pkey primary key (id),
  constraint cash_sessions_idempotency_key_key unique (idempotency_key),
  constraint cash_sessions_opening_amount_check check (opening_amount >= 0),
  constraint cash_sessions_counted_cash_check check (counted_cash is null or counted_cash >= 0),
  -- Abierta: sin datos de cierre. Cerrada: todos completos.
  constraint cash_sessions_close_fields_check check (
    (status = 'open'
      and closed_at is null and closed_by is null and expected_cash is null
      and counted_cash is null and difference is null)
    or
    (status = 'closed'
      and closed_at is not null and closed_by is not null and expected_cash is not null
      and counted_cash is not null and difference is not null)
  ),
  constraint cash_sessions_cash_register_id_fkey foreign key (cash_register_id)
    references public.cash_registers (id) on delete restrict,
  constraint cash_sessions_opened_by_fkey foreign key (opened_by) references public.profiles (id) on delete restrict,
  constraint cash_sessions_closed_by_fkey foreign key (closed_by) references public.profiles (id) on delete restrict
);

comment on table public.cash_sessions is
  'Turno de una caja: apertura, ventas y cierre con arqueo. Una sola sesión abierta por caja.';

create unique index cash_sessions_one_open_per_register_key
  on public.cash_sessions (cash_register_id) where status = 'open';
create index cash_sessions_register_opened_at_idx on public.cash_sessions (cash_register_id, opened_at desc);
create index cash_sessions_opened_by_idx on public.cash_sessions (opened_by);

create function private.cash_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'APPEND_ONLY: cash_sessions no admite DELETE' using errcode = '42501';
  end if;
  if old.status = 'closed' then
    raise exception 'APPEND_ONLY: una sesión de caja cerrada no se modifica' using errcode = '42501';
  end if;
  -- Abierta: lo único que puede pasar es el cierre; el resto no cambia.
  if new.status is distinct from 'closed'::public.cash_session_status
     or new.id is distinct from old.id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.cash_register_id is distinct from old.cash_register_id
     or new.opened_at is distinct from old.opened_at
     or new.opened_by is distinct from old.opened_by
     or new.opening_amount is distinct from old.opening_amount
     or new.created_at is distinct from old.created_at then
    raise exception 'cash_sessions: solo se permite cerrar la sesión' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.cash_sessions_guard() from public;

create trigger cash_sessions_guard
  before update or delete on public.cash_sessions
  for each row execute function private.cash_sessions_guard();
create trigger cash_sessions_no_truncate
  before truncate on public.cash_sessions
  for each statement execute function private.reject_modification();

-- ---------------------------------------------------------------------------
-- 2. sales (§15.3.4)
-- ---------------------------------------------------------------------------
create table public.sales (
  id uuid not null default gen_random_uuid(),
  sale_number bigint generated always as identity,
  idempotency_key uuid not null,
  request_hash text not null,
  cash_session_id uuid not null,
  status public.sale_status not null default 'completed',
  total_amount numeric(12, 2) not null,
  net_amount numeric(12, 2) not null,
  vat_amount numeric(12, 2) not null,
  cash_rounding numeric(12, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  constraint sales_pkey primary key (id),
  constraint sales_sale_number_key unique (sale_number),
  constraint sales_idempotency_key_key unique (idempotency_key),
  constraint sales_total_amount_check check (total_amount > 0),
  constraint sales_net_vat_total_check check (net_amount + vat_amount = total_amount),
  constraint sales_void_fields_check check (
    (status = 'completed' and voided_at is null and voided_by is null and void_reason is null)
    or
    (status = 'voided' and voided_at is not null and voided_by is not null
      and coalesce(length(trim(void_reason)), 0) > 0)
  ),
  constraint sales_cash_session_id_fkey foreign key (cash_session_id)
    references public.cash_sessions (id) on delete restrict,
  constraint sales_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint sales_voided_by_fkey foreign key (voided_by) references public.profiles (id) on delete restrict
);

comment on table public.sales is
  'Ventas (comprobante interno NO fiscal). Inmutables; solo se anulan.';

create index sales_cash_session_id_idx on public.sales (cash_session_id);
create index sales_created_at_idx on public.sales (created_at desc);
create index sales_created_by_idx on public.sales (created_by);

create function private.sales_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'APPEND_ONLY: sales no admite DELETE' using errcode = '42501';
  end if;
  -- Única edición: completed -> voided con los datos de la anulación.
  if old.status = 'completed' and new.status = 'voided'
     and (to_jsonb(new) - 'status' - 'voided_at' - 'voided_by' - 'void_reason')
         = (to_jsonb(old) - 'status' - 'voided_at' - 'voided_by' - 'void_reason') then
    return new;
  end if;
  raise exception 'APPEND_ONLY: una venta solo admite el paso de completed a voided' using errcode = '42501';
end;
$$;

revoke all on function private.sales_guard() from public;

create trigger sales_guard
  before update or delete on public.sales
  for each row execute function private.sales_guard();
create trigger sales_no_truncate
  before truncate on public.sales
  for each statement execute function private.reject_modification();

-- ---------------------------------------------------------------------------
-- 3. sale_items (§15.3.5)
-- ---------------------------------------------------------------------------
create table public.sale_items (
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  product_id uuid not null,
  quantity numeric(12, 3) not null,
  unit_price_with_vat numeric(12, 2) not null,
  vat_rate numeric(4, 2) not null,
  line_total numeric(12, 2) not null,
  net_amount numeric(12, 2) not null,
  vat_amount numeric(12, 2) not null,
  unit_cost_price numeric(12, 2) not null,
  product_sku text not null,
  product_name text not null,
  constraint sale_items_pkey primary key (id),
  constraint sale_items_sale_product_key unique (sale_id, product_id),
  constraint sale_items_quantity_check check (quantity > 0),
  constraint sale_items_line_total_check check (line_total > 0),
  constraint sale_items_net_vat_line_check check (net_amount + vat_amount = line_total),
  constraint sale_items_sale_id_fkey foreign key (sale_id) references public.sales (id) on delete restrict,
  constraint sale_items_product_id_fkey foreign key (product_id) references public.products (id) on delete restrict
);

comment on table public.sale_items is
  'Ítems de una venta con copia (snapshot) de precio, IVA, costo, SKU y nombre. Inmutable.';

create index sale_items_product_id_idx on public.sale_items (product_id);

-- ---------------------------------------------------------------------------
-- 4. sale_payments (§15.3.6)
-- ---------------------------------------------------------------------------
create table public.sale_payments (
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  payment_method_id uuid not null,
  amount numeric(12, 2) not null,
  tendered_amount numeric(12, 2),
  reference text,
  constraint sale_payments_pkey primary key (id),
  constraint sale_payments_sale_method_key unique (sale_id, payment_method_id),
  constraint sale_payments_amount_check check (amount > 0),
  constraint sale_payments_tendered_check check (tendered_amount is null or tendered_amount >= amount),
  constraint sale_payments_sale_id_fkey foreign key (sale_id) references public.sales (id) on delete restrict,
  constraint sale_payments_payment_method_id_fkey foreign key (payment_method_id)
    references public.payment_methods (id) on delete restrict
);

comment on table public.sale_payments is
  'Pagos de una venta. amount = lo aplicado a la venta; para el efectivo, lo que entra de verdad en la caja (ya redondeado). Inmutable.';

create index sale_payments_payment_method_id_idx on public.sale_payments (payment_method_id);

-- Ítems y pagos: nunca se modifican ni se borran.
create trigger sale_items_append_only
  before update or delete on public.sale_items
  for each row execute function private.reject_modification();
create trigger sale_items_no_truncate
  before truncate on public.sale_items
  for each statement execute function private.reject_modification();
create trigger sale_payments_append_only
  before update or delete on public.sale_payments
  for each row execute function private.reject_modification();
create trigger sale_payments_no_truncate
  before truncate on public.sale_payments
  for each statement execute function private.reject_modification();

-- ---------------------------------------------------------------------------
-- 5. stock_movements.sale_item_id (§15.3.7)
-- ---------------------------------------------------------------------------
alter table public.stock_movements add column sale_item_id uuid;

alter table public.stock_movements
  add constraint stock_movements_sale_item_id_fkey
    foreign key (sale_item_id) references public.sale_items (id) on delete restrict,
  -- Un movimiento `sale` siempre tiene su ítem de venta, y solo ellos lo tienen.
  add constraint stock_movements_sale_item_check
    check ((movement_type = 'sale'::public.movement_type) = (sale_item_id is not null));

comment on column public.stock_movements.sale_item_id is
  'Ítem de venta que originó el movimiento (solo movement_type = sale).';

create index stock_movements_sale_item_id_idx on public.stock_movements (sale_item_id)
  where sale_item_id is not null;

-- Una venta descuenta stock UNA sola vez: como mucho un movimiento `sale` por
-- ítem y lote, aunque falle la lógica de la RPC.
create unique index stock_movements_sale_item_batch_key
  on public.stock_movements (sale_item_id, batch_id)
  where movement_type = 'sale'::public.movement_type;

-- ---------------------------------------------------------------------------
-- 6. Consistencia de cada venta, garantizada por la base
-- ---------------------------------------------------------------------------
-- Al confirmar la transacción: los ítems suman el total, los pagos suman el
-- total más el redondeo del efectivo, y el stock descontado de cada ítem es
-- exactamente su cantidad. Diferida para que la RPC inserte en cualquier orden.
create function private.check_sale_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_items numeric;
  v_net numeric;
  v_vat numeric;
  v_count int;
  v_paid numeric;
  v_bad_items int;
begin
  select coalesce(sum(i.line_total), 0), coalesce(sum(i.net_amount), 0), coalesce(sum(i.vat_amount), 0), count(*)
    into v_items, v_net, v_vat, v_count
  from public.sale_items i where i.sale_id = new.id;

  if v_count = 0 or v_items <> new.total_amount or v_net <> new.net_amount or v_vat <> new.vat_amount then
    raise exception 'Venta % inconsistente: los ítems no suman el total', new.id using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0) into v_paid from public.sale_payments p where p.sale_id = new.id;
  if v_paid <> new.total_amount + new.cash_rounding then
    raise exception 'Venta % inconsistente: los pagos no suman el total más el redondeo', new.id using errcode = '23514';
  end if;

  select count(*) into v_bad_items
  from public.sale_items i
  where i.sale_id = new.id
    and i.quantity is distinct from (
      select coalesce(sum(m.quantity), 0) from public.stock_movements m
      where m.sale_item_id = i.id and m.movement_type = 'sale'::public.movement_type
    );
  if v_bad_items > 0 then
    raise exception 'Venta % inconsistente: el stock descontado no coincide con los ítems', new.id using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function private.check_sale_consistency() from public;

create constraint trigger sales_consistency_check
  after insert on public.sales
  deferrable initially deferred
  for each row execute function private.check_sale_consistency();

-- ---------------------------------------------------------------------------
-- 7. RLS y permisos (§15.7): authenticated solo lee
-- ---------------------------------------------------------------------------
alter table public.cash_sessions enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;

revoke all on table public.cash_sessions, public.sales, public.sale_items, public.sale_payments
  from public, anon, authenticated;
grant select on table public.cash_sessions, public.sales, public.sale_items, public.sale_payments to authenticated;

-- Sesiones: todas las abiertas (para elegir caja, P-33), las que abrió el usuario y,
-- para encargado y dueño, todas.
create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (
    (select private.is_active_user())
    and (status = 'open' or opened_by = (select auth.uid()) or (select private.is_manager_or_admin()))
  );

-- Ventas: el empleado, las suyas (P-34); encargado y dueño, todas.
create policy sales_select on public.sales
  for select to authenticated
  using (
    (select private.is_active_user())
    and (created_by = (select auth.uid()) or (select private.is_manager_or_admin()))
  );

-- Ítems y pagos: los de las ventas que el usuario puede ver (la RLS de sales aplica en la subconsulta).
create policy sale_items_select on public.sale_items
  for select to authenticated
  using ((select private.is_active_user()) and exists (select 1 from public.sales s where s.id = sale_id));

create policy sale_payments_select on public.sale_payments
  for select to authenticated
  using ((select private.is_active_user()) and exists (select 1 from public.sales s where s.id = sale_id));
