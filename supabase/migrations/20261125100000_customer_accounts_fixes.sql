-- Correcciones de cuentas corrientes (contrato §23, v0.13.1). Solo reemplaza dos funciones con la misma
-- firma (los permisos se conservan); no crea, modifica ni borra datos.
--   * register_account_sale: repetir una venta ya registrada devuelve esa venta aunque el cliente se
--     haya desactivado después; «cliente inactivo» solo frena ventas nuevas.
--   * void_customer_payment: bloquea al cliente antes de anular, así una venta a cuenta simultánea no
--     compara el límite con un pago que se está anulando.

create or replace function public.register_account_sale(
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
  if not found then
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

  -- Un cliente desactivado no compra a cuenta. Va después del reintento; el error deshace toda la venta.
  if not v_customer.is_active then
    perform private.raise_business_error('CUSTOMER_NOT_FOUND');
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

create or replace function public.void_customer_payment(p_payment_id uuid, p_reason text)
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

  -- Mismo bloqueo (y mismo orden, caja y después cliente) que register_customer_payment: una venta a
  -- cuenta del mismo cliente espera a que la anulación termine antes de calcular su saldo.
  perform 1 from public.customers c where c.id = v_payment.customer_id for update;

  update public.customer_payments p
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = trim(p_reason)
  where p.id = v_payment.id
  returning * into v_payment;
  return v_payment;
end;
$$;
