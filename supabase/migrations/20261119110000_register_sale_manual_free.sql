-- Importe manual para productos de balanza y líneas libres (contrato v0.10.0, §20), paso 2 de 2: register_sale.
--
-- Cambio COMPATIBLE de register_sale (create or replace conserva los permisos de EXECUTE; la firma no
-- cambia): cada ítem de p_items admite además
--   * manual_line_total (producto por kilo): el importe con IVA de la etiqueta de la balanza;
--   * un ítem SIN product_id es una línea libre: { description, vat_rate, quantity, manual_line_total }.
-- Las llamadas anteriores (sin esos campos) siguen funcionando, y su hash de idempotencia no cambia
-- (los campos nuevos solo se agregan al hash cuando vienen). Códigos nuevos: INVALID_MANUAL_PRICE e
-- INVALID_FREE_ITEM. Excepción explícita al principio "el precio lo pone la base" (§15.1): solo aplica
-- a productos por kilo con importe manual y a las líneas libres, y deja la diferencia auditable.
-- Se quitaron dos variables sin usar (avisos de supabase db lint).
--
-- Solo reemplaza una función; no modifica tablas ni datos.

create or replace function public.register_sale(
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
  v_sale public.sales;
  v_item_id uuid;
  v_batch public.product_batches;
  v_remaining numeric;
  v_take numeric;
  v_usable numeric;
  v_occurred_at timestamptz := now();
  v_step integer;
  v_dpct numeric;
  v_dmax numeric;
  v_list_total numeric;
  v_suggested numeric;
  v_applied numeric;
  v_discount_amount numeric;
  v_discount_total numeric := 0;
  v_prod_items jsonb;
  v_free jsonb := '[]'::jsonb;
  v_free_norm text;
  v_free_el jsonb;
  v_free_desc text;
  v_free_vat numeric;
  v_free_qty numeric;
  v_free_total numeric;
  v_catalog_total numeric;
  v_is_manual boolean;
  v_source text;
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

  -- discount_percent es opcional: un número o null. Cualquier otro tipo es INVALID_DISCOUNT.
  begin
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e -> 'discount_percent') not in ('number', 'null')
    ) then
      perform private.raise_business_error('INVALID_DISCOUNT');
    end if;
  exception when others then
    perform private.raise_business_error('INVALID_DISCOUNT');
  end;

  -- manual_line_total (producto por kilo con importe de etiqueta) es opcional: un número o null.
  begin
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e -> 'manual_line_total') not in ('number', 'null')
    ) then
      perform private.raise_business_error('INVALID_AMOUNT');
    end if;
  exception when others then
    perform private.raise_business_error('INVALID_AMOUNT');
  end;

  -- Un ítem sin product_id es una LÍNEA LIBRE (§20.8): descripción, IVA, cantidad entera e importe.
  -- Se validan en el orden en que llegan; no descuentan stock y no se agrupan.
  select jsonb_agg(e) into v_prod_items
  from jsonb_array_elements(p_items) e
  where jsonb_typeof(e -> 'product_id') is distinct from 'null' and (e -> 'product_id') is not null;
  v_prod_items := coalesce(v_prod_items, '[]'::jsonb);

  for v_free_el in
    select e from jsonb_array_elements(p_items) e
    where jsonb_typeof(e -> 'product_id') is not distinct from 'null' or (e -> 'product_id') is null
  loop
    if jsonb_typeof(v_free_el -> 'description') is distinct from 'string'
       or jsonb_typeof(v_free_el -> 'vat_rate') is distinct from 'number'
       or jsonb_typeof(v_free_el -> 'quantity') is distinct from 'number' then
      perform private.raise_business_error('INVALID_FREE_ITEM');
    end if;
    v_free_desc := trim(v_free_el ->> 'description');
    v_free_vat := (v_free_el ->> 'vat_rate')::numeric;
    v_free_qty := (v_free_el ->> 'quantity')::numeric;
    if length(v_free_desc) not between 1 and 80
       or v_free_vat not in (10.5, 21)
       or v_free_qty < 1 or v_free_qty <> trunc(v_free_qty) or v_free_qty > 99999 then
      perform private.raise_business_error('INVALID_FREE_ITEM');
    end if;
    if jsonb_typeof(v_free_el -> 'manual_line_total') is distinct from 'number' then
      perform private.raise_business_error('INVALID_AMOUNT');
    end if;
    v_free_total := private.normalize_money((v_free_el ->> 'manual_line_total')::numeric);
    if v_free_total is null or v_free_total <= 0 then
      perform private.raise_business_error('INVALID_AMOUNT');
    end if;
    -- Sin descuento por cantidad: discount_percent nulo o 0.
    if (v_free_el ->> 'discount_percent') is not null and (v_free_el ->> 'discount_percent')::numeric <> 0 then
      perform private.raise_business_error('INVALID_DISCOUNT');
    end if;
    v_free := v_free || jsonb_build_object(
      'description', v_free_desc, 'vat_rate', v_free_vat, 'quantity', v_free_qty, 'total', v_free_total
    );
  end loop;

  -- Importes manuales de los productos: más de 2 decimales, cero o negativo -> INVALID_AMOUNT.
  begin
    if exists (
      select 1 from jsonb_array_elements(v_prod_items) e
      where (e ->> 'manual_line_total') is not null
        and coalesce(private.normalize_money((e ->> 'manual_line_total')::numeric), 0) <= 0
    ) then
      perform private.raise_business_error('INVALID_AMOUNT');
    end if;
  exception when others then
    perform private.raise_business_error('INVALID_AMOUNT');
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'product_id', x.product_id, 'quantity', x.qty, 'discount', x.discount, 'mixed', x.mixed,
             'manual', x.manual, 'manual_mixed', x.manual_mixed
           ) order by x.product_id), '[]'::jsonb)
      into v_agg
    from (
      select (e ->> 'product_id')::uuid as product_id,
             sum((e ->> 'quantity')::numeric) as qty,
             -- Porcentaje tal como lo envió el cliente (nulo si no lo mandó).
             max((e ->> 'discount_percent')::numeric) as discount,
             -- Las líneas repetidas de un producto tienen que coincidir: todas sin porcentaje o todas con el mismo.
             (count(distinct (e ->> 'discount_percent')::numeric) > 1
              or (bool_or((e ->> 'discount_percent') is null) and bool_or((e ->> 'discount_percent') is not null))) as mixed,
             -- Importe de la etiqueta: se suma entre líneas repetidas del mismo producto (dos etiquetas del mismo fiambre).
             sum(private.normalize_money((e ->> 'manual_line_total')::numeric)) as manual,
             (bool_or((e ->> 'manual_line_total') is null) and bool_or((e ->> 'manual_line_total') is not null)) as manual_mixed
      from jsonb_array_elements(v_prod_items) e
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

  select string_agg((x ->> 'product_id') || ':' || coalesce(((x ->> 'quantity')::numeric)::numeric(12, 3)::text, '')
                    || case when x ->> 'discount' is null then '' else ':d=' || round((x ->> 'discount')::numeric, 2)::text end
                    || case when x ->> 'manual' is null then '' else ':m=' || round((x ->> 'manual')::numeric, 2)::text end,
                    ',' order by x ->> 'product_id')
    into v_items_norm
  from jsonb_array_elements(v_agg) x;
  select string_agg(coalesce(x ->> 'payment_method_id', '') || ':' || coalesce(x ->> 'amount', '') || ':' || coalesce(x ->> 'tendered', ''), ',' order by x ->> 'payment_method_id')
    into v_pay_norm
  from jsonb_array_elements(v_pay) x;
  -- Líneas libres: entran con todos sus campos, en el orden en que se enviaron.
  select string_agg(
           (f.el ->> 'description') || ':' || (f.el ->> 'vat_rate') || ':' || (f.el ->> 'quantity') || ':' || (f.el ->> 'total'),
           ',' order by f.ord)
    into v_free_norm
  from jsonb_array_elements(v_free) with ordinality as f(el, ord);
  v_hash := md5(p_cash_session_id::text || '|' || coalesce(v_items_norm, '') || '|' || coalesce(v_pay_norm, '')
                || coalesce('|F:' || v_free_norm, ''));

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

  -- Regla del descuento por cantidad (contrato §16.1), configurable.
  select cs.quantity_discount_step, cs.quantity_discount_percent, cs.quantity_discount_max_percent
    into v_step, v_dpct, v_dmax
  from public.sales_settings cs limit 1;
  v_step := coalesce(v_step, 6);
  v_dpct := coalesce(v_dpct, 5);
  v_dmax := coalesce(v_dmax, 30);

  -- Precios: se toman de la base en este instante; el cliente no envía precios.
  -- Productos en orden de id (orden fijo, evita bloqueos cruzados entre ventas).
  for v_row in
    select r.product_id, r.quantity, r.discount, r.mixed, r.manual, r.manual_mixed
    from jsonb_to_recordset(v_agg) as r(product_id uuid, quantity numeric, discount numeric, mixed boolean, manual numeric, manual_mixed boolean)
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

    -- Importe manual (§20.2): solo productos por kilo; todas las líneas del producto con importe o ninguna.
    v_is_manual := v_row.manual is not null;
    if v_row.manual_mixed then
      perform private.raise_business_error('INVALID_MANUAL_PRICE');
    end if;
    if v_is_manual and v_product.sale_unit <> 'kg'::public.sale_unit then
      perform private.raise_business_error('INVALID_MANUAL_PRICE');
    end if;
    if not v_is_manual and v_product.sale_price_with_vat <= 0 then
      perform private.raise_business_error('PRODUCT_PRICE_INVALID');
    end if;

    v_catalog_total := round(v_row.quantity * v_product.sale_price_with_vat, 2);
    v_list_total := case when v_is_manual then v_row.manual else v_catalog_total end;
    if v_list_total <= 0 then
      perform private.raise_business_error('INVALID_QUANTITY');
    end if;
    v_source := case when v_is_manual then 'manual' else 'list' end;

    -- Descuento: sugerido por la regla; el cajero puede cambiarlo entre 0 y el tope (P-41, P-42).
    if v_row.mixed then
      perform private.raise_business_error('INVALID_DISCOUNT');
    end if;
    v_suggested := private.suggested_discount(v_row.quantity, v_product.sale_unit, v_step, v_dpct, v_dmax);
    if v_is_manual then
      -- Sin descuento por cantidad con importe manual: nulo o 0.
      if v_row.discount is not null and v_row.discount <> 0 then
        perform private.raise_business_error('INVALID_DISCOUNT');
      end if;
      v_suggested := 0;
      v_applied := 0;
    elsif v_row.discount is null then
      v_applied := v_suggested;
    else
      if v_row.discount < 0 or v_row.discount > v_dmax or abs(v_row.discount - round(v_row.discount, 2)) >= 0.000001 then
        perform private.raise_business_error('INVALID_DISCOUNT');
      end if;
      v_applied := round(v_row.discount, 2);
    end if;
    v_discount_amount := round(v_list_total * v_applied / 100, 2);
    v_line_total := v_list_total - v_discount_amount;
    if v_line_total <= 0 then
      perform private.raise_business_error('INVALID_DISCOUNT');
    end if;
    v_line_net := round(v_line_total / (1 + v_product.vat_rate / 100), 2);

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'sku', v_product.sku,
      'name', v_product.name,
      'quantity', v_row.quantity,
      'unit_price_with_vat', case when v_is_manual then round(v_list_total / v_row.quantity, 2) else v_product.sale_price_with_vat end,
      'price_source', v_source,
      'catalog_line_total', case when v_is_manual then v_catalog_total end,
      'vat_rate', v_product.vat_rate,
      'unit_cost_price', v_product.cost_price,
      'list_line_total', v_list_total,
      'suggested_discount_percent', v_suggested,
      'discount_percent', v_applied,
      'discount_amount', v_discount_amount,
      'line_total', v_line_total,
      'net_amount', v_line_net,
      'vat_amount', v_line_total - v_line_net
    );
    v_total := v_total + v_line_total;
    v_discount_total := v_discount_total + v_discount_amount;
    v_net := v_net + v_line_net;
    v_vat := v_vat + (v_line_total - v_line_net);
  end loop;

  -- Líneas libres (§20.8): sin producto, sin stock, sin costo. Cada una queda como un ítem propio.
  for v_free_el in select value from jsonb_array_elements(v_free)
  loop
    v_free_total := (v_free_el ->> 'total')::numeric;
    v_free_vat := (v_free_el ->> 'vat_rate')::numeric;
    v_free_qty := (v_free_el ->> 'quantity')::numeric;
    v_line_net := round(v_free_total / (1 + v_free_vat / 100), 2);
    v_lines := v_lines || jsonb_build_object(
      'product_id', null,
      'sku', null,
      'name', v_free_el ->> 'description',
      'quantity', v_free_qty,
      'unit_price_with_vat', round(v_free_total / v_free_qty, 2),
      'price_source', 'free',
      'catalog_line_total', null,
      'vat_rate', v_free_vat,
      'unit_cost_price', null,
      'list_line_total', v_free_total,
      'suggested_discount_percent', 0,
      'discount_percent', 0,
      'discount_amount', 0,
      'line_total', v_free_total,
      'net_amount', v_line_net,
      'vat_amount', v_free_total - v_line_net
    );
    v_total := v_total + v_free_total;
    v_net := v_net + v_line_net;
    v_vat := v_vat + (v_free_total - v_line_net);
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
    discount_total, rounding_amount, rounding_multiple, notes, created_by
  )
  values (
    p_idempotency_key, v_hash, v_session.id, v_total, v_net, v_vat,
    v_discount_total, v_rounding, v_multiple, nullif(trim(p_notes), ''), (select auth.uid())
  )
  returning * into v_sale;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items (
      sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name,
      list_line_total, suggested_discount_percent, discount_percent, discount_amount,
      price_source, catalog_line_total
    )
    values (
      v_sale.id, (v_line ->> 'product_id')::uuid, (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_with_vat')::numeric, (v_line ->> 'vat_rate')::numeric,
      (v_line ->> 'line_total')::numeric, (v_line ->> 'net_amount')::numeric, (v_line ->> 'vat_amount')::numeric,
      (v_line ->> 'unit_cost_price')::numeric, v_line ->> 'sku', v_line ->> 'name',
      (v_line ->> 'list_line_total')::numeric, (v_line ->> 'suggested_discount_percent')::numeric,
      (v_line ->> 'discount_percent')::numeric, (v_line ->> 'discount_amount')::numeric,
      v_line ->> 'price_source', (v_line ->> 'catalog_line_total')::numeric
    )
    returning id into v_item_id;

    -- Las líneas libres no descuentan stock.
    continue when v_line ->> 'price_source' = 'free';

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
  'Registra una venta: precios de la base (o importe manual de balanza / líneas libres, contrato §20), descuento por cantidad, stock FEFO descontado una sola vez y pagos con redondeo acotado. Idempotente. Contrato §15.6, §16.3 y §20.';
