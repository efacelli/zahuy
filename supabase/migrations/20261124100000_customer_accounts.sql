-- Clientes y cuentas corrientes (contrato v0.13.0, §23). Solo AGREGA estructuras:
--   * tablas customers, customer_account_charges y customer_payments;
--   * medio de pago 'account' («Cuenta corriente»);
--   * RPC register_account_sale, register_customer_payment, void_customer_payment y
--     authorize_customer_over_limit;
--   * vistas v_customer_balances y v_customer_account_movements;
--   * el arqueo (v_cash_session_summary y close_cash_session) suma el efectivo cobrado de cuentas.
-- No modifica ni borra datos existentes. register_sale NO cambia: una venta con 'account' solo se
-- confirma si en la misma transacción se registró el cargo al cliente (constraint trigger diferido).
--
-- Reglas decididas por efacelli (2026-11-24): límite de crédito por cliente; superarlo requiere la
-- autorización del encargado o del dueño; cualquier empleado vende a cuenta; solo encargado y dueño
-- administran clientes; los pagos se cobran en la caja (parciales o totales) y entran al arqueo;
-- sin bloqueo automático por atraso.

-- ---------------------------------------------------------------------------
-- 1. customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  document_number text,
  phone text,
  address text,
  notes text,
  credit_limit numeric(12, 2) not null default 0,
  is_blocked boolean not null default false,
  blocked_reason text,
  is_active boolean not null default true,
  over_limit_authorized_until timestamptz,
  over_limit_authorized_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint customers_pkey primary key (id),
  constraint customers_name_check check (length(trim(name)) between 1 and 80),
  constraint customers_document_check check (document_number is null or document_number ~ '^[0-9]{7,11}$'),
  constraint customers_phone_check check (phone is null or length(trim(phone)) between 1 and 40),
  constraint customers_address_check check (address is null or length(trim(address)) between 1 and 120),
  constraint customers_notes_check check (notes is null or length(notes) <= 500),
  constraint customers_credit_limit_check check (credit_limit >= 0),
  constraint customers_blocked_reason_check check (blocked_reason is null or length(blocked_reason) <= 200),
  constraint customers_over_limit_check check ((over_limit_authorized_until is null) = (over_limit_authorized_by is null)),
  constraint customers_over_limit_by_fkey foreign key (over_limit_authorized_by) references public.profiles (id) on delete restrict,
  constraint customers_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint customers_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.customers is
  'Clientes con cuenta corriente (§23). El saldo no se guarda: se calcula de cargos y pagos.';

create unique index customers_document_number_key on public.customers (document_number) where document_number is not null;
create index customers_name_idx on public.customers (lower(private.unaccent_text(name)));

create trigger customers_no_delete
  before delete on public.customers
  for each row execute function private.reject_modification();
create trigger customers_set_audit_columns
  before insert or update on public.customers
  for each row execute function private.set_audit_columns();
create trigger customers_audit
  after insert or update on public.customers
  for each row execute function private.write_audit_log();

alter table public.customers enable row level security;

revoke all on table public.customers from public, anon, authenticated;
grant select on table public.customers to authenticated;
grant insert (name, document_number, phone, address, notes, credit_limit, is_blocked, blocked_reason, is_active)
  on table public.customers to authenticated;
grant update (name, document_number, phone, address, notes, credit_limit, is_blocked, blocked_reason, is_active)
  on table public.customers to authenticated;

create policy customers_select on public.customers
  for select to authenticated using ((select private.is_active_user()));
create policy customers_insert on public.customers
  for insert to authenticated with check ((select private.is_manager_or_admin()));
create policy customers_update on public.customers
  for update to authenticated
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

-- ---------------------------------------------------------------------------
-- 2. Medio de pago «Cuenta corriente»
-- ---------------------------------------------------------------------------
insert into public.payment_methods (code, name, is_cash, sort_order)
values ('account', 'Cuenta corriente', false, 6)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. customer_account_charges: lo que una venta dejó en la cuenta del cliente
-- ---------------------------------------------------------------------------
create table public.customer_account_charges (
  id uuid not null default gen_random_uuid(),
  sale_id uuid not null,
  sale_number bigint not null,
  customer_id uuid not null,
  amount numeric(12, 2) not null,
  over_limit boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  voided_at timestamptz,
  constraint customer_account_charges_pkey primary key (id),
  constraint customer_account_charges_sale_id_key unique (sale_id),
  constraint customer_account_charges_amount_check check (amount > 0),
  constraint customer_account_charges_sale_id_fkey foreign key (sale_id) references public.sales (id) on delete restrict,
  constraint customer_account_charges_customer_id_fkey foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint customer_account_charges_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict
);

comment on table public.customer_account_charges is
  'Cargo a cuenta corriente de una venta (§23). Se anula sola cuando se anula la venta. Inmutable salvo voided_at.';

create index customer_account_charges_customer_idx on public.customer_account_charges (customer_id, created_at desc);

create function private.customer_account_charges_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los cargos de cuenta corriente no se borran' using errcode = '42501';
  end if;
  if old.voided_at is not null or new.voided_at is null
     or (to_jsonb(new) - 'voided_at') is distinct from (to_jsonb(old) - 'voided_at') then
    raise exception 'Un cargo solo puede pasar a anulado, una vez' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.customer_account_charges_guard() from public;

create trigger customer_account_charges_guard
  before update or delete on public.customer_account_charges
  for each row execute function private.customer_account_charges_guard();
create trigger customer_account_charges_no_truncate
  before truncate on public.customer_account_charges
  for each statement execute function private.reject_modification();

alter table public.customer_account_charges enable row level security;
revoke all on table public.customer_account_charges from public, anon, authenticated;
grant select on table public.customer_account_charges to authenticated;
create policy customer_account_charges_select on public.customer_account_charges
  for select to authenticated using ((select private.is_active_user()));

-- Anular la venta anula el cargo (la deuda baja sola).
create function private.sales_void_account_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'voided' and old.status <> 'voided' then
    update public.customer_account_charges c
    set voided_at = new.voided_at
    where c.sale_id = new.id and c.voided_at is null;
  end if;
  return null;
end;
$$;

revoke all on function private.sales_void_account_charge() from public;

create trigger sales_void_account_charge
  after update of status on public.sales
  for each row execute function private.sales_void_account_charge();

-- Una venta pagada con 'account' solo se confirma con su cargo al cliente (lo crea register_account_sale).
create function private.sale_payments_account_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.payment_methods pm where pm.id = new.payment_method_id and pm.code = 'account')
     and not exists (select 1 from public.customer_account_charges c where c.sale_id = new.sale_id and c.amount = new.amount) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_CUSTOMER_REQUIRED';
  end if;
  return null;
end;
$$;

revoke all on function private.sale_payments_account_check() from public;

create constraint trigger sale_payments_account_check
  after insert on public.sale_payments
  deferrable initially deferred
  for each row execute function private.sale_payments_account_check();

-- ---------------------------------------------------------------------------
-- 4. customer_payments: pagos de deuda cobrados en la caja
-- ---------------------------------------------------------------------------
create table public.customer_payments (
  id uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  request_hash text not null,
  customer_id uuid not null,
  cash_session_id uuid not null,
  payment_method_id uuid not null,
  amount numeric(12, 2) not null,
  tendered_amount numeric(12, 2),
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  constraint customer_payments_pkey primary key (id),
  constraint customer_payments_idempotency_key_key unique (idempotency_key),
  constraint customer_payments_amount_check check (amount > 0),
  constraint customer_payments_tendered_check check (tendered_amount is null or tendered_amount >= amount),
  constraint customer_payments_reference_check check (reference is null or length(reference) <= 60),
  constraint customer_payments_notes_check check (notes is null or length(notes) <= 200),
  constraint customer_payments_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(trim(void_reason)) > 0)
  ),
  constraint customer_payments_customer_id_fkey foreign key (customer_id) references public.customers (id) on delete restrict,
  constraint customer_payments_cash_session_id_fkey foreign key (cash_session_id) references public.cash_sessions (id) on delete restrict,
  constraint customer_payments_payment_method_id_fkey foreign key (payment_method_id) references public.payment_methods (id) on delete restrict,
  constraint customer_payments_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint customer_payments_voided_by_fkey foreign key (voided_by) references public.profiles (id) on delete restrict
);

comment on table public.customer_payments is
  'Pagos de cuenta corriente cobrados en una sesión de caja (§23). El efectivo entra al arqueo. Inmutable salvo la anulación.';

create index customer_payments_customer_idx on public.customer_payments (customer_id, created_at desc);
create index customer_payments_cash_session_idx on public.customer_payments (cash_session_id);

create function private.customer_payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los pagos de cuenta corriente no se borran: se anulan' using errcode = '42501';
  end if;
  if old.voided_at is not null or new.voided_at is null
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
        is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'Un pago solo puede pasar a anulado, una vez' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.customer_payments_guard() from public;

create trigger customer_payments_guard
  before update or delete on public.customer_payments
  for each row execute function private.customer_payments_guard();
create trigger customer_payments_no_truncate
  before truncate on public.customer_payments
  for each statement execute function private.reject_modification();

alter table public.customer_payments enable row level security;
revoke all on table public.customer_payments from public, anon, authenticated;
grant select on table public.customer_payments to authenticated;
create policy customer_payments_select on public.customer_payments
  for select to authenticated using ((select private.is_active_user()));

-- ---------------------------------------------------------------------------
-- 5. Saldo
-- ---------------------------------------------------------------------------
create function private.customer_balance(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (
    coalesce((select sum(c.amount) from public.customer_account_charges c
              where c.customer_id = p_customer_id and c.voided_at is null), 0)
    - coalesce((select sum(p.amount) from public.customer_payments p
                where p.customer_id = p_customer_id and p.voided_at is null), 0)
  )::numeric(12, 2);
$$;

revoke all on function private.customer_balance(uuid) from public;

-- ---------------------------------------------------------------------------
-- 6. register_account_sale
-- ---------------------------------------------------------------------------
create function public.register_account_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null,
  p_allow_over_limit boolean default false
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_sale public.sales;
  v_charge public.customer_account_charges;
  v_amount numeric;
  v_balance numeric;
  v_over boolean := false;
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  -- El cliente se bloquea primero: dos ventas a la misma cuenta no comparan el límite a la vez.
  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if not found or not v_customer.is_active then
    perform private.raise_business_error('CUSTOMER_NOT_FOUND');
  end if;

  v_sale := public.register_sale(p_idempotency_key, p_cash_session_id, p_items, p_payments, p_notes);

  -- Reintento: la venta ya tenía su cargo.
  select * into v_charge from public.customer_account_charges c where c.sale_id = v_sale.id;
  if found then
    if v_charge.customer_id <> p_customer_id then
      perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
    end if;
    return v_sale;
  end if;

  select sp.amount into v_amount
  from public.sale_payments sp
  join public.payment_methods pm on pm.id = sp.payment_method_id and pm.code = 'account'
  where sp.sale_id = v_sale.id;
  if v_amount is null then
    perform private.raise_business_error('ACCOUNT_PAYMENT_REQUIRED');
  end if;

  if v_customer.is_blocked then
    perform private.raise_business_error('ACCOUNT_BLOCKED');
  end if;

  v_balance := private.customer_balance(v_customer.id);
  if v_balance + v_amount > v_customer.credit_limit then
    if p_allow_over_limit and private.is_manager_or_admin() then
      v_over := true;
    elsif v_customer.over_limit_authorized_until is not null and v_customer.over_limit_authorized_until > now() then
      -- La autorización del encargado o del dueño sirve para UNA venta.
      update public.customers c
      set over_limit_authorized_until = null, over_limit_authorized_by = null
      where c.id = v_customer.id;
      v_over := true;
    else
      raise exception using errcode = 'P0001', message = 'CREDIT_LIMIT_EXCEEDED',
        detail = (v_balance + v_amount - v_customer.credit_limit)::numeric(12, 2)::text;
    end if;
  end if;

  insert into public.customer_account_charges (sale_id, sale_number, customer_id, amount, over_limit, created_by)
  values (v_sale.id, v_sale.sale_number, v_customer.id, v_amount, v_over, (select auth.uid()));

  return v_sale;
end;
$$;

comment on function public.register_account_sale(uuid, uuid, uuid, jsonb, jsonb, text, boolean) is
  'Venta con cuenta corriente: register_sale más el cargo al cliente, con bloqueo y límite de crédito. Contrato §23.';

revoke all on function public.register_account_sale(uuid, uuid, uuid, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.register_account_sale(uuid, uuid, uuid, jsonb, jsonb, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. register_customer_payment
-- ---------------------------------------------------------------------------
create function public.register_customer_payment(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_payment_method_id uuid,
  p_amount numeric,
  p_tendered_amount numeric default null,
  p_reference text default null,
  p_notes text default null
)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.customer_payments;
  v_session public.cash_sessions;
  v_method public.payment_methods;
  v_amount numeric;
  v_tendered numeric;
  v_hash text;
  v_payment public.customer_payments;
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  begin
    v_amount := private.normalize_money(p_amount);
    v_tendered := private.normalize_money(p_tendered_amount);
  exception when others then
    perform private.raise_business_error('INVALID_AMOUNT');
  end;
  if v_amount is null or v_amount <= 0 then
    perform private.raise_business_error('INVALID_AMOUNT');
  end if;

  v_hash := md5(concat_ws('|', p_cash_session_id, p_customer_id, p_payment_method_id, v_amount, v_tendered));
  select * into v_existing from public.customer_payments x where x.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = v_hash then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  select * into v_session from public.cash_sessions s where s.id = p_cash_session_id for share;
  if not found then
    perform private.raise_business_error('CASH_SESSION_NOT_FOUND');
  end if;
  if v_session.status <> 'open' then
    perform private.raise_business_error('CASH_SESSION_CLOSED');
  end if;

  perform 1 from public.customers c where c.id = p_customer_id for update;
  if not found then
    perform private.raise_business_error('CUSTOMER_NOT_FOUND');
  end if;

  select * into v_method from public.payment_methods pm where pm.id = p_payment_method_id and pm.is_active;
  if not found or v_method.code = 'account' then
    perform private.raise_business_error('PAYMENT_METHOD_INVALID');
  end if;
  if v_tendered is not null and (not v_method.is_cash or v_tendered < v_amount) then
    perform private.raise_business_error('INVALID_PAYMENT');
  end if;

  if v_amount > private.customer_balance(p_customer_id) then
    perform private.raise_business_error('PAYMENT_EXCEEDS_BALANCE');
  end if;

  insert into public.customer_payments (
    idempotency_key, request_hash, customer_id, cash_session_id, payment_method_id,
    amount, tendered_amount, reference, notes, created_by
  )
  values (
    p_idempotency_key, v_hash, p_customer_id, v_session.id, v_method.id,
    v_amount, v_tendered, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), (select auth.uid())
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

comment on function public.register_customer_payment(uuid, uuid, uuid, uuid, numeric, numeric, text, text) is
  'Cobra en la caja un pago (parcial o total) de la deuda de un cliente. Idempotente. Contrato §23.';

revoke all on function public.register_customer_payment(uuid, uuid, uuid, uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.register_customer_payment(uuid, uuid, uuid, uuid, numeric, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. void_customer_payment (encargado y dueño, con la caja todavía abierta)
-- ---------------------------------------------------------------------------
create function public.void_customer_payment(p_payment_id uuid, p_reason text)
returns public.customer_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.customer_payments;
  v_status public.cash_session_status;
begin
  if not private.is_active_user() or not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.raise_business_error('REASON_REQUIRED');
  end if;

  select * into v_payment from public.customer_payments p where p.id = p_payment_id for update;
  if not found then
    perform private.raise_business_error('PAYMENT_NOT_FOUND');
  end if;
  if v_payment.voided_at is not null then
    perform private.raise_business_error('ALREADY_VOIDED');
  end if;
  select s.status into v_status from public.cash_sessions s where s.id = v_payment.cash_session_id for share;
  if v_status <> 'open' then
    perform private.raise_business_error('CASH_SESSION_CLOSED');
  end if;

  update public.customer_payments p
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = trim(p_reason)
  where p.id = v_payment.id
  returning * into v_payment;
  return v_payment;
end;
$$;

comment on function public.void_customer_payment(uuid, text) is
  'Anula un pago de cuenta corriente mientras su sesión de caja siga abierta. Encargado y dueño. Contrato §23.';

revoke all on function public.void_customer_payment(uuid, text) from public, anon;
grant execute on function public.void_customer_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. authorize_customer_over_limit: el encargado o el dueño habilita UNA venta por encima del límite
-- ---------------------------------------------------------------------------
create function public.authorize_customer_over_limit(p_customer_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
begin
  if not private.is_active_user() or not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;
  update public.customers c
  set over_limit_authorized_until = now() + interval '30 minutes',
      over_limit_authorized_by = (select auth.uid())
  where c.id = p_customer_id and c.is_active
  returning * into v_customer;
  if not found then
    perform private.raise_business_error('CUSTOMER_NOT_FOUND');
  end if;
  return v_customer;
end;
$$;

comment on function public.authorize_customer_over_limit(uuid) is
  'Habilita por 30 minutos una sola venta a cuenta por encima del límite del cliente. Encargado y dueño. Contrato §23.';

revoke all on function public.authorize_customer_over_limit(uuid) from public, anon;
grant execute on function public.authorize_customer_over_limit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Vistas de lectura
-- ---------------------------------------------------------------------------
create view public.v_customer_balances
with (security_invoker = true)
as
select
  c.id as customer_id,
  c.name,
  c.document_number,
  c.phone,
  c.address,
  c.notes,
  c.credit_limit,
  c.is_blocked,
  c.blocked_reason,
  c.is_active,
  c.over_limit_authorized_until,
  (coalesce(ch.total, 0) - coalesce(py.total, 0))::numeric(12, 2) as balance,
  greatest(c.credit_limit - (coalesce(ch.total, 0) - coalesce(py.total, 0)), 0)::numeric(12, 2) as available_credit,
  ch.last_at as last_charge_at,
  py.last_at as last_payment_at
from public.customers c
left join lateral (
  select sum(x.amount) as total, max(x.created_at) as last_at
  from public.customer_account_charges x where x.customer_id = c.id and x.voided_at is null
) ch on true
left join lateral (
  select sum(x.amount) as total, max(x.created_at) as last_at
  from public.customer_payments x where x.customer_id = c.id and x.voided_at is null
) py on true;

comment on view public.v_customer_balances is
  'Una fila por cliente con su saldo (cargos − pagos vigentes) y crédito disponible. Contrato §23.';

create view public.v_customer_account_movements
with (security_invoker = true)
as
select
  c.customer_id,
  'charge'::text as kind,
  c.id as movement_id,
  c.created_at,
  c.amount,
  c.sale_id,
  c.sale_number,
  null::text as payment_method_name,
  null::text as reference,
  c.over_limit,
  c.voided_at,
  null::text as void_reason,
  c.created_by
from public.customer_account_charges c
union all
select
  p.customer_id,
  'payment'::text,
  p.id,
  p.created_at,
  p.amount,
  null::uuid,
  null::bigint,
  pm.name,
  p.reference,
  false,
  p.voided_at,
  p.void_reason,
  p.created_by
from public.customer_payments p
join public.payment_methods pm on pm.id = p.payment_method_id;

comment on view public.v_customer_account_movements is
  'Cargos (ventas a cuenta) y pagos de cada cliente, incluidos los anulados. Contrato §23.';

revoke all on table public.v_customer_balances, public.v_customer_account_movements from public, anon, authenticated;
grant select on table public.v_customer_balances, public.v_customer_account_movements to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Arqueo: el efectivo cobrado de cuentas corrientes entra en la caja
-- ---------------------------------------------------------------------------
-- Misma vista con una columna nueva al final (account_cash_collected) y expected_cash que la suma.
create or replace view public.v_cash_session_summary
with (security_invoker = true)
as
select
  s.id as cash_session_id,
  s.cash_register_id,
  r.name as cash_register_name,
  s.status,
  s.opened_at,
  s.opened_by,
  s.closed_at,
  s.closed_by,
  s.opening_amount,
  coalesce(a.sales_count, 0)::integer as sales_count,
  coalesce(a.sales_total, 0)::numeric(12, 2) as sales_total,
  coalesce(a.voided_count, 0)::integer as voided_count,
  case when m.is_manager then coalesce(a.cash_collected, 0)::numeric(12, 2) end as cash_collected,
  case when m.is_manager then coalesce(a.rounding_total, 0)::numeric(12, 2) end as rounding_total,
  case
    when s.status = 'closed' and (m.is_manager or s.opened_by = (select auth.uid())) then s.expected_cash
    when s.status = 'open' and m.is_manager
      then (s.opening_amount + coalesce(a.cash_collected, 0) + coalesce(ac.cash, 0))::numeric(12, 2)
  end as expected_cash,
  case when s.status = 'closed' and (m.is_manager or s.opened_by = (select auth.uid())) then s.counted_cash end as counted_cash,
  case when s.status = 'closed' and (m.is_manager or s.opened_by = (select auth.uid())) then s.difference end as difference,
  case when m.is_manager then coalesce(ac.cash, 0)::numeric(12, 2) end as account_cash_collected
from public.cash_sessions s
join public.cash_registers r on r.id = s.cash_register_id
cross join lateral (select private.is_manager_or_admin() as is_manager) m
left join lateral (
  select
    count(*) filter (where x.status = 'completed') as sales_count,
    sum(x.total_amount) filter (where x.status = 'completed') as sales_total,
    count(*) filter (where x.status = 'voided') as voided_count,
    sum(x.rounding_amount) filter (where x.status = 'completed') as rounding_total,
    (
      select sum(p.amount)
      from public.sale_payments p
      join public.payment_methods pm on pm.id = p.payment_method_id and pm.is_cash
      join public.sales x2 on x2.id = p.sale_id
      where x2.cash_session_id = s.id and x2.status = 'completed'
    ) as cash_collected
  from public.sales x
  where x.cash_session_id = s.id
) a on true
left join lateral (
  select sum(cp.amount) as cash
  from public.customer_payments cp
  join public.payment_methods pm on pm.id = cp.payment_method_id and pm.is_cash
  where cp.cash_session_id = s.id and cp.voided_at is null
) ac on true;

create or replace function public.close_cash_session(
  p_cash_session_id uuid,
  p_counted_cash numeric,
  p_close_notes text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
  v_counted numeric;
  v_collected numeric;
  v_account_cash numeric;
  v_expected numeric;
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  select * into v_session from public.cash_sessions s where s.id = p_cash_session_id for update;
  if not found then
    perform private.raise_business_error('CASH_SESSION_NOT_FOUND');
  end if;
  if v_session.opened_by is distinct from (select auth.uid()) and not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;
  if v_session.status = 'closed' then
    perform private.raise_business_error('CASH_SESSION_CLOSED');
  end if;

  v_counted := private.normalize_money(p_counted_cash);
  if v_counted is null or v_counted < 0 then
    perform private.raise_business_error('INVALID_AMOUNT');
  end if;

  select coalesce(sum(p.amount), 0) into v_collected
  from public.sale_payments p
  join public.payment_methods pm on pm.id = p.payment_method_id and pm.is_cash
  join public.sales x on x.id = p.sale_id
  where x.cash_session_id = v_session.id and x.status = 'completed';

  -- §23: el efectivo de los pagos de cuenta corriente también está en el cajón.
  select coalesce(sum(cp.amount), 0) into v_account_cash
  from public.customer_payments cp
  join public.payment_methods pm on pm.id = cp.payment_method_id and pm.is_cash
  where cp.cash_session_id = v_session.id and cp.voided_at is null;

  v_expected := v_session.opening_amount + v_collected + v_account_cash;

  update public.cash_sessions s
  set status = 'closed',
      closed_at = now(),
      closed_by = (select auth.uid()),
      expected_cash = v_expected,
      counted_cash = v_counted,
      difference = v_counted - v_expected,
      close_notes = nullif(trim(p_close_notes), '')
  where s.id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.close_cash_session(uuid, numeric, text) is
  'Cierra el turno: efectivo esperado = apertura + efectivo de ventas + efectivo de pagos de cuenta corriente (§23). Contrato §15.6.';
