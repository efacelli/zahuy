-- Etapa 5 (ventas y caja), paso 5 de 5 (1/2): RPC de caja y ventas.
-- Contrato: docs/DATA_CONTRACT.md v0.6.3, §15.6, §15.9 y P-30.
--
-- Solo crea funciones; no modifica tablas ni datos. Mismas reglas comunes que
-- las RPC de stock (SECURITY DEFINER, search_path vacío, una transacción por
-- llamada, idempotencia con bloqueo consultivo, errores P0001 con el código en
-- MESSAGE, EXECUTE solo para authenticated).

-- ---------------------------------------------------------------------------
-- 1. Funciones auxiliares (esquema private)
-- ---------------------------------------------------------------------------
-- Monto SUGERIDO por el redondeo del total (P-30 y P-39): múltiplo más cercano, desde la
-- mitad sube; con menos de la mitad del múltiplo se cobra exacto. round_cash(1237, 100) = 1200;
-- (1249, 100) = 1200; (1250, 100) = 1300; (49.99, 100) = 49.99. La caja (frontend) usa la misma
-- regla para sugerir y el cajero puede cambiar el monto: register_sale NO exige este valor, solo
-- el límite de abajo. Queda como definición única de la regla y la fijan las pruebas.
-- div() es división entera exacta en numeric: sin errores de coma flotante.
create function private.round_cash(p_amount numeric, p_multiple numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount is null or p_multiple is null or p_multiple <= 0 or p_amount <= 0 then p_amount
    when p_amount < p_multiple / 2 then p_amount
    else div(p_amount * 2 + p_multiple, p_multiple * 2) * p_multiple
  end;
$$;

-- Importe con hasta 2 decimales. Tolera ruido de coma flotante del cliente
-- (por ejemplo 0.30000000000000004) y lo redondea a centavos; devuelve NULL
-- si es nulo, no es número finito o tiene decimales reales de más.
create function private.normalize_money(p_amount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount is null then null
    when abs(p_amount - round(p_amount, 2)) < 0.000001 then round(p_amount, 2)
    else null
  end;
$$;

-- Descuenta `sale` de un lote YA bloqueado (FOR UPDATE) e inserta el movimiento
-- ligado a su ítem de venta. Quien llama validó todo lo de negocio.
create function private.apply_sale_movement(
  p_batch public.product_batches,
  p_quantity numeric,
  p_sale_item_id uuid,
  p_operation_key uuid,
  p_occurred_at timestamptz
)
returns public.stock_movements
language plpgsql
set search_path = ''
as $$
declare
  v_after numeric;
  v_movement public.stock_movements;
begin
  v_after := p_batch.quantity_available - p_quantity;
  if v_after < 0 then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK';
  end if;

  update public.product_batches b set quantity_available = v_after where b.id = p_batch.id;

  insert into public.stock_movements (
    idempotency_key, operation_key, product_id, batch_id, movement_type, quantity,
    batch_quantity_after, occurred_at, created_by, sale_item_id
  )
  values (
    gen_random_uuid(), p_operation_key, p_batch.product_id, p_batch.id, 'sale'::public.movement_type, p_quantity,
    v_after, p_occurred_at, (select auth.uid()), p_sale_item_id
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function private.round_cash(numeric, numeric) from public;
revoke all on function private.normalize_money(numeric) from public;
revoke all on function private.apply_sale_movement(public.product_batches, numeric, uuid, uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- 2. open_cash_session (§15.6)
-- ---------------------------------------------------------------------------
create function public.open_cash_session(
  p_idempotency_key uuid,
  p_cash_register_id uuid,
  p_opening_amount numeric
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.cash_sessions;
  v_session public.cash_sessions;
  v_amount numeric;
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  v_amount := private.normalize_money(p_opening_amount);

  select * into v_existing from public.cash_sessions s where s.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.cash_register_id is not distinct from p_cash_register_id
       and v_existing.opening_amount is not distinct from v_amount then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (select 1 from public.sales x where x.idempotency_key = p_idempotency_key)
     or exists (select 1 from public.stock_movements m
                where m.idempotency_key = p_idempotency_key or m.operation_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if v_amount is null or v_amount < 0 then
    perform private.raise_business_error('INVALID_AMOUNT');
  end if;

  if not exists (select 1 from public.cash_registers r where r.id = p_cash_register_id and r.is_active) then
    perform private.raise_business_error('CASH_REGISTER_NOT_FOUND');
  end if;

  -- Serializa dos aperturas simultáneas de la misma caja.
  perform pg_advisory_xact_lock(hashtextextended('cash_register:' || p_cash_register_id::text, 0));
  if exists (select 1 from public.cash_sessions s where s.cash_register_id = p_cash_register_id and s.status = 'open') then
    perform private.raise_business_error('CASH_SESSION_ALREADY_OPEN');
  end if;

  insert into public.cash_sessions (idempotency_key, cash_register_id, opening_amount, opened_by)
  values (p_idempotency_key, p_cash_register_id, v_amount, (select auth.uid()))
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.open_cash_session(uuid, uuid, numeric) is
  'Abre un turno de caja con el efectivo inicial. Una sola sesión abierta por caja. Contrato §15.6.';

-- ---------------------------------------------------------------------------
-- 3. close_cash_session (§15.6)
-- ---------------------------------------------------------------------------
-- Bloquea la sesión FOR UPDATE: register_sale la toma FOR SHARE, así ninguna
-- venta se cuela mientras se calcula el arqueo.
create function public.close_cash_session(
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

  v_expected := v_session.opening_amount + v_collected;

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
  'Cierra el turno: calcula el efectivo esperado (apertura + efectivo cobrado) y guarda la diferencia. Contrato §15.6.';

-- ---------------------------------------------------------------------------
-- 4. register_sale (§15.6)
-- ---------------------------------------------------------------------------
create function public.register_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.sales;
  v_session public.cash_sessions;
  v_agg jsonb;
  v_pay jsonb;
  v_hash text;
  v_items_norm text;
  v_pay_norm text;
  v_row record;
  v_product public.products;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_line_total numeric;
  v_line_net numeric;
  v_total numeric := 0;
  v_net numeric := 0;
  v_vat numeric := 0;
  v_paid numeric := 0;
  v_rounding numeric;
  v_multiple numeric;
  v_method public.payment_methods;
  v_pay_row record;
  v_amount numeric;
  v_tendered numeric;
  v_sale public.sales;
  v_item_id uuid;
  v_batch public.product_batches;
  v_remaining numeric;
  v_take numeric;
  v_usable numeric;
  v_occurred_at timestamptz := now();
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Solicitud normalizada: ítems agrupados por producto y pagos por medio.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.raise_business_error('EMPTY_SALE');
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    perform private.raise_business_error('PAYMENT_MISMATCH');
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'quantity', x.qty) order by x.product_id), '[]'::jsonb)
      into v_agg
    from (
      select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::numeric) as qty
      from jsonb_array_elements(p_items) e
      group by 1
    ) x;
  exception when others then
    perform private.raise_business_error('INVALID_QUANTITY');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'payment_method_id', x.pm_id, 'amount', x.amt, 'tendered', x.tnd, 'reference', x.ref
           ) order by x.pm_id), '[]'::jsonb)
      into v_pay
    from (
      select (e ->> 'payment_method_id')::uuid as pm_id,
             private.normalize_money((e ->> 'amount')::numeric) as amt,
             private.normalize_money((e ->> 'tendered_amount')::numeric) as tnd,
             nullif(trim(e ->> 'reference'), '') as ref
      from jsonb_array_elements(p_payments) e
    ) x;
  exception when others then
    perform private.raise_business_error('INVALID_PAYMENT');
  end;

  select string_agg((x ->> 'product_id') || ':' || coalesce(((x ->> 'quantity')::numeric)::numeric(12, 3)::text, ''), ',' order by x ->> 'product_id')
    into v_items_norm
  from jsonb_array_elements(v_agg) x;
  select string_agg(coalesce(x ->> 'payment_method_id', '') || ':' || coalesce(x ->> 'amount', '') || ':' || coalesce(x ->> 'tendered', ''), ',' order by x ->> 'payment_method_id')
    into v_pay_norm
  from jsonb_array_elements(v_pay) x;
  v_hash := md5(p_cash_session_id::text || '|' || coalesce(v_items_norm, '') || '|' || coalesce(v_pay_norm, ''));

  -- Idempotencia: misma clave y misma solicitud devuelve la venta ya hecha,
  -- incluso si la sesión se cerró entre el intento y el reintento.
  select * into v_existing from public.sales x where x.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = v_hash then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (select 1 from public.cash_sessions s where s.idempotency_key = p_idempotency_key)
     or exists (select 1 from public.stock_movements m
                where m.idempotency_key = p_idempotency_key or m.operation_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  -- Sesión abierta. FOR SHARE: close_cash_session (FOR UPDATE) espera a las ventas en curso.
  select * into v_session from public.cash_sessions s where s.id = p_cash_session_id for share;
  if not found then
    perform private.raise_business_error('CASH_SESSION_NOT_FOUND');
  end if;
  if v_session.status <> 'open' then
    perform private.raise_business_error('CASH_SESSION_CLOSED');
  end if;

  -- Precios: se toman de la base en este instante; el cliente no envía precios.
  -- Productos en orden de id (orden fijo, evita bloqueos cruzados entre ventas).
  for v_row in
    select r.product_id, r.quantity
    from jsonb_to_recordset(v_agg) as r(product_id uuid, quantity numeric)
    order by r.product_id
  loop
    if v_row.quantity is null then
      perform private.raise_business_error('INVALID_QUANTITY');
    end if;
    select * into v_product from public.products p where p.id = v_row.product_id;
    if not found then
      perform private.raise_business_error('PRODUCT_NOT_FOUND');
    end if;
    if not v_product.is_active then
      perform private.raise_business_error('PRODUCT_INACTIVE');
    end if;
    perform private.assert_valid_quantity(v_row.quantity, v_product.sale_unit);
    if v_product.sale_price_with_vat <= 0 then
      perform private.raise_business_error('PRODUCT_PRICE_INVALID');
    end if;

    v_line_total := round(v_row.quantity * v_product.sale_price_with_vat, 2);
    if v_line_total <= 0 then
      perform private.raise_business_error('INVALID_QUANTITY');
    end if;
    v_line_net := round(v_line_total / (1 + v_product.vat_rate / 100), 2);

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'sku', v_product.sku,
      'name', v_product.name,
      'quantity', v_row.quantity,
      'unit_price_with_vat', v_product.sale_price_with_vat,
      'vat_rate', v_product.vat_rate,
      'unit_cost_price', v_product.cost_price,
      'line_total', v_line_total,
      'net_amount', v_line_net,
      'vat_amount', v_line_total - v_line_net
    );
    v_total := v_total + v_line_total;
    v_net := v_net + v_line_net;
    v_vat := v_vat + (v_line_total - v_line_net);
  end loop;

  -- Pagos y redondeo del total (P-30): la caja sugiere el total redondeado y el cajero puede
  -- cambiarlo; la base no exige un valor, solo que la diferencia con el total quede dentro del límite.
  if (select count(distinct x ->> 'payment_method_id') from jsonb_array_elements(v_pay) x)
     <> jsonb_array_length(v_pay) then
    perform private.raise_business_error('INVALID_PAYMENT');
  end if;

  for v_pay_row in
    select r.payment_method_id, r.amount, r.tendered
    from jsonb_to_recordset(v_pay) as r(payment_method_id uuid, amount numeric, tendered numeric, reference text)
  loop
    select * into v_method from public.payment_methods pm where pm.id = v_pay_row.payment_method_id and pm.is_active;
    if not found then
      perform private.raise_business_error('PAYMENT_METHOD_INVALID');
    end if;
    if v_pay_row.amount is null or v_pay_row.amount <= 0 then
      perform private.raise_business_error('INVALID_PAYMENT');
    end if;
    if v_method.is_cash then
      -- Solo el efectivo tiene "recibido" y vuelto: lo recibido no puede ser menor que lo que se cobra.
      if v_pay_row.tendered is not null and v_pay_row.tendered < v_pay_row.amount then
        perform private.raise_business_error('INVALID_PAYMENT');
      end if;
    elsif v_pay_row.tendered is not null then
      perform private.raise_business_error('INVALID_PAYMENT');
    end if;
    v_paid := v_paid + v_pay_row.amount;
  end loop;

  -- La diferencia entre lo cobrado y el total es el redondeo: tiene que quedar estrictamente
  -- dentro de un múltiplo (por ejemplo, menos de $100 hacia arriba o hacia abajo).
  select cs.rounding_multiple into v_multiple from public.sales_settings cs limit 1;
  v_multiple := coalesce(v_multiple, 100);
  v_rounding := v_paid - v_total;
  if abs(v_rounding) >= v_multiple then
    perform private.raise_business_error('PAYMENT_MISMATCH');
  end if;

  -- Venta, ítems, descuento de stock FEFO y pagos: todo en esta transacción.
  insert into public.sales (
    idempotency_key, request_hash, cash_session_id, total_amount, net_amount, vat_amount,
    rounding_amount, rounding_multiple, notes, created_by
  )
  values (
    p_idempotency_key, v_hash, v_session.id, v_total, v_net, v_vat,
    v_rounding, v_multiple, nullif(trim(p_notes), ''), (select auth.uid())
  )
  returning * into v_sale;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items (
      sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name
    )
    values (
      v_sale.id, (v_line ->> 'product_id')::uuid, (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_with_vat')::numeric, (v_line ->> 'vat_rate')::numeric,
      (v_line ->> 'line_total')::numeric, (v_line ->> 'net_amount')::numeric, (v_line ->> 'vat_amount')::numeric,
      (v_line ->> 'unit_cost_price')::numeric, v_line ->> 'sku', v_line ->> 'name'
    )
    returning id into v_item_id;

    -- FEFO (§8.7): bloquea los lotes utilizables y verifica que alcancen antes de
    -- descontar. Los lotes vencidos no se venden (P-15).
    perform 1 from public.product_batches b
    where b.product_id = (v_line ->> 'product_id')::uuid and b.quantity_available > 0
    order by b.expires_on nulls last, b.received_on, b.id
    for update;

    select coalesce(sum(b.quantity_available), 0) into v_usable
    from public.product_batches b
    where b.product_id = (v_line ->> 'product_id')::uuid
      and b.quantity_available > 0
      and (b.expires_on is null or b.expires_on >= private.today_ar());
    if v_usable < (v_line ->> 'quantity')::numeric then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK', detail = v_line ->> 'product_id';
    end if;

    v_remaining := (v_line ->> 'quantity')::numeric;
    for v_batch in
      select * from public.product_batches b
      where b.product_id = (v_line ->> 'product_id')::uuid
        and b.quantity_available > 0
        and (b.expires_on is null or b.expires_on >= private.today_ar())
      order by b.expires_on nulls last, b.received_on, b.id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.quantity_available);
      perform private.apply_sale_movement(v_batch, v_take, v_item_id, v_sale.id, v_occurred_at);
      v_remaining := v_remaining - v_take;
    end loop;
  end loop;

  for v_pay_row in
    select r.payment_method_id, r.amount, r.tendered, r.reference
    from jsonb_to_recordset(v_pay) as r(payment_method_id uuid, amount numeric, tendered numeric, reference text)
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, tendered_amount, reference)
    values (v_sale.id, v_pay_row.payment_method_id, v_pay_row.amount, v_pay_row.tendered, v_pay_row.reference);
  end loop;

  select * into v_sale from public.sales x where x.id = v_sale.id;
  return v_sale;
end;
$$;

comment on function public.register_sale(uuid, uuid, jsonb, jsonb, text) is
  'Registra una venta: precios de la base, stock FEFO descontado una sola vez, pagos con redondeo del total acotado. Idempotente. Contrato §15.6.';

-- ---------------------------------------------------------------------------
-- 5. void_sale (§15.6)
-- ---------------------------------------------------------------------------
create function public.void_sale(
  p_idempotency_key uuid,
  p_sale_id uuid,
  p_reason text
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_session public.cash_sessions;
  v_move public.stock_movements;
  v_batch public.product_batches;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  select * into v_sale from public.sales x where x.id = p_sale_id for update;
  if not found then
    perform private.raise_business_error('SALE_NOT_FOUND');
  end if;

  -- Reintento: la venta ya fue anulada con ESTA clave.
  if v_sale.status = 'voided' then
    if exists (
      select 1 from public.stock_movements m
      join public.sale_items i on i.id = (
        select o.sale_item_id from public.stock_movements o where o.id = m.reverses_movement_id
      )
      where m.operation_key = p_idempotency_key and i.sale_id = v_sale.id
    ) then
      return v_sale;
    end if;
    perform private.raise_business_error('ALREADY_VOIDED');
  end if;

  if exists (select 1 from public.sales x where x.idempotency_key = p_idempotency_key)
     or exists (select 1 from public.cash_sessions s where s.idempotency_key = p_idempotency_key)
     or exists (select 1 from public.stock_movements m
                where m.idempotency_key = p_idempotency_key or m.operation_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.raise_business_error('REASON_REQUIRED');
  end if;

  -- Solo con la sesión de caja abierta (P-32). FOR SHARE: no se cierra mientras se anula.
  select * into v_session from public.cash_sessions s where s.id = v_sale.cash_session_id for share;
  if v_session.status <> 'open' then
    perform private.raise_business_error('CASH_SESSION_CLOSED');
  end if;

  -- Bloquea los lotes en el mismo orden FEFO que usa la venta.
  perform 1 from public.product_batches b
  where b.id in (
    select m.batch_id from public.stock_movements m
    join public.sale_items i on i.id = m.sale_item_id
    where i.sale_id = v_sale.id and m.movement_type = 'sale'::public.movement_type
  )
  order by b.expires_on nulls last, b.received_on, b.id
  for update;

  for v_move in
    select m.* from public.stock_movements m
    join public.sale_items i on i.id = m.sale_item_id
    where i.sale_id = v_sale.id and m.movement_type = 'sale'::public.movement_type
    order by m.id
  loop
    select * into v_batch from public.product_batches b where b.id = v_move.batch_id;
    -- Compensación al MISMO lote, con reverses_movement_id (un movimiento se revierte una sola vez).
    perform private.apply_batch_movement(
      gen_random_uuid(), p_idempotency_key, v_batch, 'adjustment_in'::public.movement_type,
      v_move.quantity, p_reason, null, now(), v_move.id
    );
  end loop;

  update public.sales x
  set status = 'voided', voided_at = now(), voided_by = (select auth.uid()), void_reason = trim(p_reason)
  where x.id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

comment on function public.void_sale(uuid, uuid, text) is
  'Anula una venta con la sesión de caja abierta: devuelve el stock a los mismos lotes con movimientos compensatorios. Solo encargado y dueño. Contrato §15.6.';

-- ---------------------------------------------------------------------------
-- 6. Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.open_cash_session(uuid, uuid, numeric) from public, anon;
revoke all on function public.close_cash_session(uuid, numeric, text) from public, anon;
revoke all on function public.register_sale(uuid, uuid, jsonb, jsonb, text) from public, anon;
revoke all on function public.void_sale(uuid, uuid, text) from public, anon;

grant execute on function public.open_cash_session(uuid, uuid, numeric) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, text) to authenticated;
grant execute on function public.register_sale(uuid, uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.void_sale(uuid, uuid, text) to authenticated;
