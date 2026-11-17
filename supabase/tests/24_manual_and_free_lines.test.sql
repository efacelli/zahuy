-- Importe manual para productos de balanza y líneas libres (contrato v0.10.0, §20). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'sale_items' and column_name in ('price_source', 'catalog_line_total')),
  2, 'sale_items tiene price_source y catalog_line_total'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'sale_items'
      and column_name in ('product_id', 'product_sku', 'unit_cost_price') and is_nullable = 'YES'),
  3, 'product_id, product_sku y unit_cost_price son nulables (solo para líneas libres)'
);
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'sale_items' and column_name = 'price_source'),
  '''list''::text', 'price_source es list por defecto'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_sale'),
  'p_idempotency_key uuid, p_cash_session_id uuid, p_items jsonb, p_payments jsonb, p_notes text',
  'register_sale conserva su firma (los campos nuevos van dentro de p_items)'
);
select is(
  (select count(*)::int from public.sale_items where price_source <> 'list' or catalog_line_total is not null),
  (select count(*)::int from public.sale_items where price_source <> 'list' or catalog_line_total is not null),
  'las filas anteriores a esta versión conservan price_source = list'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'enzo.encargado.man@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'eva.empleada.man@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000d3', 'ivan.inactivo.man@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000d1';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000d3';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000b0c1', 'Categoría manual');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000b0b1', 'Marca manual');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_c (code text primary key, id uuid) on commit drop;
create temporary table t_s (code text primary key, id uuid) on commit drop;
grant all on t_p, t_c, t_s to authenticated;

create function pg_temp.pid(p text) returns uuid language sql as $$ select id from t_p where code = p $$;
create function pg_temp.sid(c text) returns uuid language sql as $$ select id from t_c where code = c $$;
create function pg_temp.vid(c text) returns uuid language sql as $$ select id from t_s where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
-- Ítem de producto: cantidad, porcentaje de descuento y importe manual opcionales.
create function pg_temp.it(p text, q numeric, d jsonb default null, m jsonb default null) returns jsonb language sql as
  $$ select jsonb_build_object('product_id', pg_temp.pid(p), 'quantity', q)
     || case when d is null then '{}'::jsonb else jsonb_build_object('discount_percent', d) end
     || case when m is null then '{}'::jsonb else jsonb_build_object('manual_line_total', m) end $$;
-- Línea libre.
create function pg_temp.fr(d jsonb, v jsonb, q jsonb, t jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('product_id', null, 'description', d, 'vat_rate', v, 'quantity', q, 'manual_line_total', t) $$;
create function pg_temp.debit(a numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid('debit'), 'amount', a, 'tendered_amount', null)) $$;
create function pg_temp.stock_of(p text) returns numeric language sql as $$
  select coalesce(sum(b.quantity_available), 0) from public.product_batches b where b.product_id = pg_temp.pid(p) $$;
grant execute on function pg_temp.pid(text), pg_temp.sid(text), pg_temp.vid(text), pg_temp.mid(text),
  pg_temp.it(text, numeric, jsonb, jsonb), pg_temp.fr(jsonb, jsonb, jsonb, jsonb), pg_temp.debit(numeric),
  pg_temp.stock_of(text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}', true);
set local role authenticated;
-- KA: por kilo, 8.840 el kg (IVA 10,5), costo 5.000. UA: unidad 1.210. KI: por kilo inactivo. KL: por litro.
insert into t_p select 'KA', (public.create_product(gen_random_uuid(), 'Manual KA jamón', '00000000-0000-4000-8000-00000000b0c1',
  '00000000-0000-4000-8000-00000000b0b1', 'kg', 5000, 8000, 10.5, p_initial_quantity => 100, p_expires_on => private.today_ar() + 30)).id;
insert into t_p select 'UA', (public.create_product(gen_random_uuid(), 'Manual UA fideos', '00000000-0000-4000-8000-00000000b0c1',
  '00000000-0000-4000-8000-00000000b0b1', 'unit', 100, 1000, 21, p_initial_quantity => 100, p_expires_on => private.today_ar() + 90)).id;
insert into t_p select 'KI', (public.create_product(gen_random_uuid(), 'Manual KI inactivo', '00000000-0000-4000-8000-00000000b0c1',
  '00000000-0000-4000-8000-00000000b0b1', 'kg', 100, 1000, 21, p_initial_quantity => 10, p_expires_on => private.today_ar() + 30)).id;
insert into t_p select 'KL', (public.create_product(gen_random_uuid(), 'Manual KL aceite', '00000000-0000-4000-8000-00000000b0c1',
  '00000000-0000-4000-8000-00000000b0b1', 'l', 100, 1000, 21, p_initial_quantity => 10, p_expires_on => private.today_ar() + 30)).id;
update public.products set is_active = false where id = pg_temp.pid('KI');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}', true);
set local role authenticated;
insert into t_c select 'S1', (public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 0)).id;

-- ---------------------------------------------------------------------------
-- Importe manual (producto por kilo con la etiqueta de la balanza)
-- ---------------------------------------------------------------------------
-- 0,245 kg a 2.200,50 (el precio de Zahuy daría 2.165,80).
insert into t_s select 'M1', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('KA', 0.245, null, '2200.50')), pg_temp.debit(2200.50))).id;
select results_eq(
  $$select price_source, list_line_total, line_total, discount_amount, catalog_line_total, unit_price_with_vat, net_amount, vat_amount, quantity
    from public.sale_items where sale_id = pg_temp.vid('M1')$$,
  $$values ('manual'::text, 2200.50::numeric, 2200.50::numeric, 0.00::numeric, 2165.80::numeric, 8981.63::numeric, 1991.40::numeric, 209.10::numeric, 0.245::numeric)$$,
  'M1: importe de la etiqueta en line_total, catálogo 2.165,80 para auditar, IVA 10,5 discriminado sobre el importe, precio por kg informativo'
);
select is((select total_amount from public.sales where id = pg_temp.vid('M1')), 2200.50::numeric, 'M1: el total es el importe de la etiqueta');
select is(pg_temp.stock_of('KA'), 99.755::numeric, 'M1: el stock sí se descuenta (0,245 kg)');
select is(
  (select count(*)::int from public.stock_movements m join public.sale_items i on i.id = m.sale_item_id where i.sale_id = pg_temp.vid('M1')),
  1, 'M1: un movimiento de venta por el producto'
);

-- Mezclado con un ítem normal.
insert into t_s select 'M2', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('UA', 2), pg_temp.it('KA', 0.3, null, '2650')), pg_temp.debit(5070))).id;
select results_eq(
  $$select p.code, i.price_source, i.line_total, i.catalog_line_total
    from public.sale_items i join t_p p on p.id = i.product_id where i.sale_id = pg_temp.vid('M2') order by p.code$$,
  $$values ('KA'::text, 'manual'::text, 2650.00::numeric, 2652.00::numeric), ('UA', 'list', 2420.00, null)$$,
  'M2: el ítem normal queda en list (sin catalog_line_total) y el de balanza en manual'
);

-- Dos etiquetas del mismo producto se suman (cantidades e importes).
insert into t_s select 'M3', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('KA', 0.2, null, '1800'), pg_temp.it('KA', 0.3, null, '2700')), pg_temp.debit(4500))).id;
select results_eq(
  $$select count(*)::int, sum(quantity), sum(line_total), sum(catalog_line_total) from public.sale_items where sale_id = pg_temp.vid('M3')$$,
  $$values (1, 0.500::numeric, 4500.00::numeric, 4420.00::numeric)$$,
  'M3: dos etiquetas del mismo fiambre = un ítem de 0,500 kg por 4.500 (catálogo 4.420)'
);

-- Rechazos.
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('KA', 0.2, null, '1800'), pg_temp.it('KA', 0.3)), pg_temp.debit(4500))$$,
  'P0001', 'INVALID_MANUAL_PRICE', 'manual y no manual del mismo producto -> INVALID_MANUAL_PRICE'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('UA', 1, null, '1200')), pg_temp.debit(1200))$$,
  'P0001', 'INVALID_MANUAL_PRICE', 'producto por unidad con importe manual -> INVALID_MANUAL_PRICE'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KL', 1, null, '1200')), pg_temp.debit(1200))$$,
  'P0001', 'INVALID_MANUAL_PRICE', 'producto por litro con importe manual -> INVALID_MANUAL_PRICE (solo kilo)'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, null, '0')), pg_temp.debit(100))$$,
  'P0001', 'INVALID_AMOUNT', 'importe 0 -> INVALID_AMOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, null, '-50')), pg_temp.debit(100))$$,
  'P0001', 'INVALID_AMOUNT', 'importe negativo -> INVALID_AMOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, null, '10.005')), pg_temp.debit(100))$$,
  'P0001', 'INVALID_AMOUNT', 'importe con 3 decimales -> INVALID_AMOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, null, '"abc"')), pg_temp.debit(100))$$,
  'P0001', 'INVALID_AMOUNT', 'importe que no es número -> INVALID_AMOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, '10', '1800')), pg_temp.debit(1620))$$,
  'P0001', 'INVALID_DISCOUNT', 'importe manual con descuento de 10 % -> INVALID_DISCOUNT'
);
select lives_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, '0', '1800')), pg_temp.debit(1800))$$,
  'importe manual con descuento 0 -> válido'
);
select lives_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, 'null', '1800')), pg_temp.debit(1800))$$,
  'importe manual con descuento null -> válido'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KI', 0.2, null, '200')), pg_temp.debit(200))$$,
  'P0001', 'PRODUCT_INACTIVE', 'importe manual sobre un producto inactivo -> PRODUCT_INACTIVE'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 500, null, '1800')), pg_temp.debit(1800))$$,
  'P0001', 'INSUFFICIENT_STOCK', 'el importe manual no esquiva el stock -> INSUFFICIENT_STOCK'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('KA', 0.2, null, '1800')), pg_temp.debit(1500))$$,
  'P0001', 'PAYMENT_MISMATCH', 'los pagos tienen que cerrar con el importe de la etiqueta'
);

-- Idempotencia.
insert into t_s select 'I1', (public.register_sale('abababab-abab-4bab-8bab-abababababa1', pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('KA', 0.1, null, '900')), pg_temp.debit(900))).id;
select is(
  (select id from public.register_sale('abababab-abab-4bab-8bab-abababababa1', pg_temp.sid('S1'),
    jsonb_build_array(pg_temp.it('KA', 0.1, null, '900')), pg_temp.debit(900))),
  pg_temp.vid('I1'), 'mismo importe y misma clave -> la misma venta'
);
select throws_ok(
  $$select public.register_sale('abababab-abab-4bab-8bab-abababababa1', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('KA', 0.1, null, '950')), pg_temp.debit(950))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'otro importe con la misma clave -> IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.register_sale('abababab-abab-4bab-8bab-abababababa1', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('KA', 0.1)), pg_temp.debit(884))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'con y sin importe manual con la misma clave son solicitudes distintas'
);
select is(pg_temp.stock_of('KA'), 99.755 - 0.3 - 0.5 - 0.2 - 0.2 - 0.1, 'el reintento no descontó de nuevo');
reset role;

-- ---------------------------------------------------------------------------
-- Líneas libres
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}', true);
set local role authenticated;
-- 3 panes caseros a 1.500 en total (IVA 21 %).
insert into t_s select 'F1', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.fr('"Pan casero"', '21', '3', '1500')), pg_temp.debit(1500))).id;
select results_eq(
  $$select product_id, product_sku, unit_cost_price, product_name, price_source, quantity, unit_price_with_vat, vat_rate,
           line_total, list_line_total, discount_amount, net_amount, vat_amount, catalog_line_total
    from public.sale_items where sale_id = pg_temp.vid('F1')$$,
  $$values (null::uuid, null::text, null::numeric, 'Pan casero'::text, 'free'::text, 3.000::numeric, 500.00::numeric, 21.00::numeric,
            1500.00::numeric, 1500.00::numeric, 0.00::numeric, 1239.67::numeric, 260.33::numeric, null::numeric)$$,
  'F1: línea libre sin producto, sin SKU ni costo, con IVA 21 discriminado sobre el importe'
);
select is(
  (select count(*)::int from public.stock_movements m join public.sale_items i on i.id = m.sale_item_id where i.sale_id = pg_temp.vid('F1')),
  0, 'F1: una línea libre no genera movimientos de stock'
);
select is((select total_amount from public.sales where id = pg_temp.vid('F1')), 1500.00::numeric, 'F1: el total es el importe de la línea');

-- Mixta: un producto normal, una línea libre con IVA 10,5 y un importe de balanza.
insert into t_s select 'F2', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('UA', 1), pg_temp.fr('"  Servicio  "', '10.5', '1', '1105'), pg_temp.it('KA', 0.1, null, '900')),
  pg_temp.debit(3215))).id;
select results_eq(
  $$select price_source, product_name, line_total, net_amount, vat_amount from public.sale_items
    where sale_id = pg_temp.vid('F2') and price_source = 'free'$$,
  $$values ('free'::text, 'Servicio'::text, 1105.00::numeric, 1000.00::numeric, 105.00::numeric)$$,
  'F2: la descripción se recorta y el IVA 10,5 se discrimina (1.105 = 1.000 + 105)'
);
select is((select count(*)::int from public.sale_items where sale_id = pg_temp.vid('F2')), 3, 'F2: tres ítems (normal, libre y de balanza)');
select is((select sum(line_total) from public.sale_items where sale_id = pg_temp.vid('F2')), 3215.00::numeric, 'F2: los ítems suman el total');

-- Las líneas libres no se agrupan.
insert into t_s select 'F3', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.fr('"Pan casero"', '21', '1', '500'), pg_temp.fr('"Pan casero"', '21', '1', '500')), pg_temp.debit(1000))).id;
select is((select count(*)::int from public.sale_items where sale_id = pg_temp.vid('F3')), 2, 'F3: dos líneas libres iguales quedan como dos ítems');

-- Rechazos de líneas libres.
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('""', '21', '1', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'descripción vacía -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"   "', '21', '1', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'descripción de solo espacios -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr(to_jsonb(repeat('a', 81)), '21', '1', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'descripción de 81 caracteres -> INVALID_FREE_ITEM');
select lives_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr(to_jsonb(repeat('a', 80)), '21', '1', '500')), pg_temp.debit(500))$$,
  'descripción de 80 caracteres -> válida');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '27', '1', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'IVA 27 -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '"21"', '1', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'IVA como texto -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1.5', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'cantidad fraccionaria -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '0', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'cantidad 0 -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '-1', '500')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'cantidad negativa -> INVALID_FREE_ITEM');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(jsonb_build_object('product_id', null, 'vat_rate', 21, 'quantity', 1, 'manual_line_total', 500)), pg_temp.debit(500))$$,
  'P0001', 'INVALID_FREE_ITEM', 'sin descripción -> INVALID_FREE_ITEM');
select lives_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(jsonb_build_object('description', 'X', 'vat_rate', 21, 'quantity', 1, 'manual_line_total', 500)), pg_temp.debit(500))$$,
  'sin la clave product_id, un ítem completo también es una línea libre válida');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1', '0')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_AMOUNT', 'importe 0 -> INVALID_AMOUNT');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1', '-5')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_AMOUNT', 'importe negativo -> INVALID_AMOUNT');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1', '10.005')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_AMOUNT', 'importe con 3 decimales -> INVALID_AMOUNT');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1', 'null')), pg_temp.debit(500))$$,
  'P0001', 'INVALID_AMOUNT', 'sin importe -> INVALID_AMOUNT');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
    jsonb_build_array(jsonb_build_object('product_id', null, 'description', 'X', 'vat_rate', 21, 'quantity', 1, 'manual_line_total', 500, 'discount_percent', 10)), pg_temp.debit(500))$$,
  'P0001', 'INVALID_DISCOUNT', 'línea libre con descuento -> INVALID_DISCOUNT');
select lives_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
    jsonb_build_array(jsonb_build_object('product_id', null, 'description', 'X', 'vat_rate', 21, 'quantity', 1, 'manual_line_total', 500, 'discount_percent', 0)), pg_temp.debit(500))$$,
  'línea libre con descuento 0 -> válida');
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1', '500')), pg_temp.debit(300))$$,
  'P0001', 'PAYMENT_MISMATCH', 'los pagos tienen que cerrar con el importe de la línea libre');

-- Idempotencia con líneas libres: mismo orden y campos -> misma venta; otro orden o campo -> conflicto.
insert into t_s select 'FI', (public.register_sale('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdc1', pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.fr('"Pan"', '21', '1', '500'), pg_temp.fr('"Torta"', '10.5', '2', '1105')), pg_temp.debit(1605))).id;
select is(
  (select id from public.register_sale('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdc1', pg_temp.sid('S1'),
    jsonb_build_array(pg_temp.fr('"Pan"', '21', '1', '500'), pg_temp.fr('"Torta"', '10.5', '2', '1105')), pg_temp.debit(1605))),
  pg_temp.vid('FI'), 'mismas líneas libres en el mismo orden -> la misma venta'
);
select throws_ok(
  $$select public.register_sale('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdc1', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.fr('"Torta"', '10.5', '2', '1105'), pg_temp.fr('"Pan"', '21', '1', '500')), pg_temp.debit(1605))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'las líneas libres en otro orden -> IDEMPOTENCY_CONFLICT (entran en el orden enviado)'
);
select throws_ok(
  $$select public.register_sale('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdc1', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.fr('"Pan"', '21', '1', '500'), pg_temp.fr('"Tortas"', '10.5', '2', '1105')), pg_temp.debit(1605))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'otra descripción con la misma clave -> IDEMPOTENCY_CONFLICT'
);
reset role;

-- ---------------------------------------------------------------------------
-- Restricciones de la tabla (como superusuario: valen para todos)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.sale_items (sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source)
    values (pg_temp.vid('F1'), pg_temp.pid('UA'), 1, 100, 21, 100, 82.64, 17.36, null, null, 'X', 100, 'free')$$,
  '23514', null, 'CHECK: una línea libre no puede llevar producto'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source)
    values (pg_temp.vid('F1'), 1, 100, 21, 100, 82.64, 17.36, null, null, 'X', 100, 'list')$$,
  '23514', null, 'CHECK: una línea de lista sin producto se rechaza'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source)
    values (pg_temp.vid('F1'), 1, 100, 21, 100, 82.64, 17.36, 5, null, 'X', 100, 'free')$$,
  '23514', null, 'CHECK: una línea libre no tiene costo'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source)
    values (pg_temp.vid('F1'), 1, 100, 27, 100, 78.74, 21.26, null, null, 'X', 100, 'free')$$,
  '23514', null, 'CHECK: IVA de una línea libre solo 10,5 o 21'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source)
    values (pg_temp.vid('F1'), 1.5, 100, 21, 100, 82.64, 17.36, null, null, 'X', 100, 'free')$$,
  '23514', null, 'CHECK: cantidad de una línea libre entera'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source)
    values (pg_temp.vid('F1'), 1, 100, 21, 100, 82.64, 17.36, null, null, '', 100, 'free')$$,
  '23514', null, 'CHECK: descripción vacía'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source, catalog_line_total)
    values (pg_temp.vid('F1'), pg_temp.pid('KA'), 1, 100, 10.5, 100, 90.50, 9.50, 5000, 'x', 'X', 100, 'manual', null)$$,
  '23514', null, 'CHECK: una línea manual necesita su catalog_line_total'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, price_source, catalog_line_total)
    values (pg_temp.vid('F1'), pg_temp.pid('UA'), 1, 100, 21, 100, 82.64, 17.36, 5, 'x', 'X', 100, 'list', 100)$$,
  '23514', null, 'CHECK: catalog_line_total solo en líneas manuales'
);
select throws_ok(
  $$insert into public.sale_items (sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, discount_amount, price_source, catalog_line_total)
    values (pg_temp.vid('F1'), pg_temp.pid('KA'), 1, 100, 10.5, 90, 81.45, 8.55, 5000, 'x', 'X', 100, 10, 'manual', 100)$$,
  '23514', null, 'CHECK: sin descuento con importe manual'
);

-- ---------------------------------------------------------------------------
-- Anulación, vistas y ranking
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.stock_of('KA'), (select pg_temp.stock_of('KA')), 'stock de KA antes de anular');
create temporary table t_stock (k text primary key, n numeric) on commit drop;
grant all on t_stock to authenticated;
insert into t_stock values ('antes', pg_temp.stock_of('KA'));
select is((select status::text from public.void_sale(gen_random_uuid(), pg_temp.vid('M1'), 'Prueba de anulación de importe manual')), 'voided', 'se anula una venta con importe manual');
select is(pg_temp.stock_of('KA'), (select n + 0.245 from t_stock where k = 'antes'), 'la anulación devuelve los 0,245 kg al stock');
select is((select line_total from public.sale_items where sale_id = pg_temp.vid('M1')), 2200.50::numeric, 'los importes de la venta anulada quedan intactos');
select is((select status::text from public.void_sale(gen_random_uuid(), pg_temp.vid('F1'), 'Prueba de anulación de línea libre')), 'voided', 'se anula una venta solo de líneas libres (nada que compensar)');
select is(
  (select count(*)::int from public.stock_movements where operation_key is not null and reverses_movement_id is not null
     and reverses_movement_id in (select m.id from public.stock_movements m join public.sale_items i on i.id = m.sale_item_id where i.sale_id = pg_temp.vid('F1'))),
  0, 'ninguna compensación para la venta de líneas libres'
);

-- v_sales_daily: el margen cuenta solo las líneas con costo; las libres van aparte.
select results_eq(
  $$select total_amount, net_amount, free_net_total, cost_total, gross_margin
    from public.v_sales_daily where sale_date = private.today_ar()$$,
  $$select
      coalesce(sum(s.total_amount) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum(s.net_amount) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum((select sum(i.net_amount) from public.sale_items i where i.sale_id = s.id and i.price_source = 'free'))
        filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum((select sum(round(i.quantity * i.unit_cost_price, 2)) from public.sale_items i where i.sale_id = s.id))
        filter (where s.status = 'completed'), 0)::numeric(12,2),
      (coalesce(sum((select sum(i.net_amount) from public.sale_items i where i.sale_id = s.id and i.unit_cost_price is not null))
          filter (where s.status = 'completed'), 0)
        - coalesce(sum((select sum(round(i.quantity * i.unit_cost_price, 2)) from public.sale_items i where i.sale_id = s.id))
          filter (where s.status = 'completed'), 0))::numeric(12,2)
    from public.sales s
    where (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = private.today_ar()$$,
  'v_sales_daily: el total incluye las líneas libres y el margen solo las líneas con costo'
);
select ok(
  (select free_net_total from public.v_sales_daily where sale_date = private.today_ar()) > 0,
  'free_net_total muestra lo cobrado en líneas libres'
);
select ok(
  (select gross_margin from public.v_sales_daily where sale_date = private.today_ar())
    < (select net_amount - cost_total from public.v_sales_daily where sale_date = private.today_ar()),
  'el margen es menor que neto - costo: el neto de las líneas libres NO se cuenta como margen'
);

-- Ranking: sin líneas libres y con el importe manual en su producto.
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar(), private.today_ar()) r where r.product_id is null),
  0, 'el ranking no tiene filas sin producto'
);
select is(
  (select revenue_total from public.product_sales_ranking(private.today_ar(), private.today_ar()) r where r.product_id = pg_temp.pid('UA')),
  (select coalesce(sum(i.line_total), 0) from public.sale_items i join public.sales s on s.id = i.sale_id
    where i.product_id = pg_temp.pid('UA') and s.status = 'completed'
      and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = private.today_ar()),
  'el ranking suma solo lo vendido del producto (sin las líneas libres)'
);
select is(
  (select revenue_total from public.product_sales_ranking(private.today_ar(), private.today_ar()) r where r.product_id = pg_temp.pid('KA')),
  (select coalesce(sum(i.line_total), 0) from public.sale_items i join public.sales s on s.id = i.sale_id
    where i.product_id = pg_temp.pid('KA') and s.status = 'completed'
      and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = private.today_ar()),
  'el ranking suma el importe manual del fiambre'
);
reset role;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000d3", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.fr('"X"', '21', '1', '500')), pg_temp.debit(500))$$,
  'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo no cobra una línea libre'
);
reset role;
set local role anon;
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), gen_random_uuid(), '[]', '[]')$$,
  '42501', null, 'anon no ejecuta register_sale'
);
reset role;

-- Invariantes de toda venta de esta prueba y conciliación del stock.
select is(
  (select count(*)::int from public.sales s
    where s.id in (select id from t_s)
      and (s.total_amount <> (select sum(i.line_total) from public.sale_items i where i.sale_id = s.id)
        or s.discount_total <> (select sum(i.discount_amount) from public.sale_items i where i.sale_id = s.id)
        or (select sum(p.amount) from public.sale_payments p where p.sale_id = s.id) <> s.total_amount + s.rounding_amount)),
  0, 'Σ line_total = total, Σ descuentos = discount_total y Σ pagos = total + redondeo en toda venta (con líneas manuales y libres)'
);
select is(
  (select count(*)::int from public.sale_items i where i.sale_id in (select id from t_s) and i.line_total + i.discount_amount <> i.list_line_total),
  0, 'line_total + discount_amount = list_line_total en todo ítem'
);
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0, 'conciliación: ningún lote descuadrado'
);

select * from finish();
rollback;
