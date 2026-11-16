-- Descuentos por cantidad y métricas de ventas (contrato v0.7.0, §16).
-- P-41 (tope 30 %), P-42 (el cajero puede subir, bajar o quitar), P-43 (kg y l: sugerido 0),
-- P-45 (cualquier usuario activo). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura y regla del sugerido
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'sale_items'
      and column_name in ('list_line_total', 'suggested_discount_percent', 'discount_percent', 'discount_amount')),
  4, 'sale_items tiene las 4 columnas de descuento'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_settings'
      and column_name in ('quantity_discount_step', 'quantity_discount_percent', 'quantity_discount_max_percent')),
  3, 'sales_settings tiene las 3 columnas de la regla'
);
select is(
  (select array[quantity_discount_step::numeric, quantity_discount_percent, quantity_discount_max_percent] from public.sales_settings),
  array[6, 5, 30]::numeric[], 'la regla inicial es 6 unidades, 5 % y tope 30 %'
);
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in ('v_sales_daily', 'v_sales_daily_payments') and c.reloptions @> array['security_invoker=true']),
  2, 'las dos vistas diarias usan security_invoker'
);
select is(
  (select count(*)::int from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('v_sales_daily', 'v_sales_daily_payments') and g.grantee = 'anon'),
  0, 'anon no tiene permisos sobre las vistas diarias'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_sale'),
  'p_idempotency_key uuid, p_cash_session_id uuid, p_items jsonb, p_payments jsonb, p_notes text',
  'register_sale conserva su firma (el descuento va dentro de p_items)'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'EXECUTE de las RPC sigue solo para authenticated'
);

-- Regla del sugerido (§16.3): 5, 6, 11, 12, 18, 36 y 60 unidades con tope 30 %.
select is(private.suggested_discount(5, 'unit', 6, 5, 30), 0::numeric, 'sugerido con 5 unidades: 0 %');
select is(private.suggested_discount(6, 'unit', 6, 5, 30), 5::numeric, 'sugerido con 6 unidades: 5 %');
select is(private.suggested_discount(11, 'unit', 6, 5, 30), 5::numeric, 'sugerido con 11 unidades: 5 %');
select is(private.suggested_discount(12, 'unit', 6, 5, 30), 10::numeric, 'sugerido con 12 unidades: 10 %');
select is(private.suggested_discount(18, 'unit', 6, 5, 30), 15::numeric, 'sugerido con 18 unidades: 15 %');
select is(private.suggested_discount(36, 'unit', 6, 5, 30), 30::numeric, 'sugerido con 36 unidades: 30 % (tope)');
select is(private.suggested_discount(60, 'unit', 6, 5, 30), 30::numeric, 'sugerido con 60 unidades: sigue en 30 %');
select is(private.suggested_discount(6, 'box', 6, 5, 30), 5::numeric, 'cajas: 6 -> 5 %');
select is(private.suggested_discount(6, 'pack', 6, 5, 30), 5::numeric, 'packs: 6 -> 5 %');
select is(private.suggested_discount(6, 'other', 6, 5, 30), 5::numeric, 'otra unidad entera: 6 -> 5 %');
select is(private.suggested_discount(6, 'kg', 6, 5, 30), 0::numeric, 'por kilo el sugerido es 0 (P-43)');
select is(private.suggested_discount(60, 'l', 6, 5, 30), 0::numeric, 'por litro el sugerido es 0 (P-43)');
select is(private.suggested_discount(12, 'unit', 3, 5, 30), 20::numeric, 'la regla es configurable: paso 3 -> 12 u. = 20 %');
select is(private.suggested_discount(12, 'unit', 0, 5, 30), 0::numeric, 'paso inválido -> 0');

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000da', 'dora.duena.desc@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000db', 'enzo.encargado.desc@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000dc', 'eva.empleada.desc@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000da';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000db';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000e0c1', 'Categoría descuentos');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000e0b1', 'Marca descuentos');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_c (code text primary key, id uuid) on commit drop;
create temporary table t_s (code text primary key, id uuid) on commit drop;
create temporary table t_base (k text primary key, n int) on commit drop;
grant all on t_p, t_c, t_s to authenticated;
grant select on t_base to authenticated;

create function pg_temp.pid(p text) returns uuid language sql as $$ select id from t_p where code = p $$;
create function pg_temp.sid(c text) returns uuid language sql as $$ select id from t_c where code = c $$;
create function pg_temp.vid(c text) returns uuid language sql as $$ select id from t_s where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
create function pg_temp.it(p text, q numeric, d jsonb default null) returns jsonb language sql as
  $$ select jsonb_build_object('product_id', pg_temp.pid(p), 'quantity', q)
     || case when d is null then '{}'::jsonb else jsonb_build_object('discount_percent', d) end $$;
create function pg_temp.pay(c text, a numeric, t numeric default null) returns jsonb language sql as
  $$ select jsonb_build_object('payment_method_id', pg_temp.mid(c), 'amount', a, 'tendered_amount', t) $$;
create function pg_temp.stock_of(p text) returns numeric language sql as $$
  select coalesce(sum(b.quantity_available), 0) from public.product_batches b where b.product_id = pg_temp.pid(p) $$;
grant execute on function pg_temp.pid(text), pg_temp.sid(text), pg_temp.vid(text), pg_temp.mid(text),
  pg_temp.it(text, numeric, jsonb), pg_temp.pay(text, numeric, numeric), pg_temp.stock_of(text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000db", "role": "authenticated"}', true);
set local role authenticated;
-- DA 1.210 con IVA; DK 8.840 el kg; DB caja de 605; DL de 48,40.
insert into t_p select 'DA', (public.create_product(gen_random_uuid(), 'Desc DA fideos', '00000000-0000-4000-8000-00000000e0c1',
  '00000000-0000-4000-8000-00000000e0b1', 'unit', 100, 1000, 21, p_initial_quantity => 400, p_expires_on => private.today_ar() + 90)).id;
insert into t_p select 'DK', (public.create_product(gen_random_uuid(), 'Desc DK jamón', '00000000-0000-4000-8000-00000000e0c1',
  '00000000-0000-4000-8000-00000000e0b1', 'kg', 5000, 8000, 10.5, p_initial_quantity => 100, p_expires_on => private.today_ar() + 30)).id;
insert into t_p select 'DB', (public.create_product(gen_random_uuid(), 'Desc DB cajas', '00000000-0000-4000-8000-00000000e0c1',
  '00000000-0000-4000-8000-00000000e0b1', 'box', 100, 500, 21, p_initial_quantity => 50, p_expires_on => private.today_ar() + 60)).id;
reset role;

insert into t_base values
  ('sales', (select count(*)::int from public.sales)),
  ('voided_today', (select count(*)::int from public.sales
     where status = 'voided' and (created_at at time zone 'America/Argentina/Buenos_Aires')::date = private.today_ar()));

-- Eva (empleada) abre la caja: cualquier usuario activo vende y edita el descuento (P-45).
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000dc", "role": "authenticated"}', true);
set local role authenticated;
insert into t_c select 'S1', (public.open_cash_session(gen_random_uuid(),
  (select id from public.cash_registers where name = 'Caja 1'), 100)).id;

-- ---------------------------------------------------------------------------
-- Descuento sugerido y editado (la empleada, P-42 y P-45)
-- ---------------------------------------------------------------------------
-- 6 unidades de 1.210: lista 7.260, sugerido 5 % = 363, línea 6.897.
insert into t_s select 'A6', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 6)), jsonb_build_array(pg_temp.pay('debit', 6897)))).id;
select results_eq(
  $$select list_line_total, suggested_discount_percent, discount_percent, discount_amount, line_total
    from public.sale_items where sale_id = pg_temp.vid('A6')$$,
  $$values (7260.00::numeric, 5.00::numeric, 5.00::numeric, 363.00::numeric, 6897.00::numeric)$$,
  'A6: sin porcentaje se aplica el sugerido (5 %): lista 7.260, descuento 363, línea 6.897'
);
select is((select total_amount from public.sales where id = pg_temp.vid('A6')), 6897.00::numeric, 'A6: el total es la línea con descuento');
select is((select discount_total from public.sales where id = pg_temp.vid('A6')), 363.00::numeric, 'A6: discount_total');
select is((select net_amount from public.sales where id = pg_temp.vid('A6')), 5700.00::numeric, 'A6: el neto se calcula sobre la línea con descuento (6.897 / 1,21)');
select is((select vat_amount from public.sales where id = pg_temp.vid('A6')), 1197.00::numeric, 'A6: el IVA también');

-- Subir por encima del sugerido (10 %), quitarlo (0) y llegar al tope (30 %).
insert into t_s select 'A6u', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 6, '10')), jsonb_build_array(pg_temp.pay('debit', 6534)))).id;
select results_eq(
  $$select suggested_discount_percent, discount_percent, discount_amount, line_total from public.sale_items where sale_id = pg_temp.vid('A6u')$$,
  $$values (5.00::numeric, 10.00::numeric, 726.00::numeric, 6534.00::numeric)$$,
  'subir: sugerido 5 % guardado, aplicado 10 %, línea 6.534'
);
insert into t_s select 'A6z', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 6, '0')), jsonb_build_array(pg_temp.pay('debit', 7260)))).id;
select results_eq(
  $$select suggested_discount_percent, discount_percent, discount_amount, line_total from public.sale_items where sale_id = pg_temp.vid('A6z')$$,
  $$values (5.00::numeric, 0.00::numeric, 0.00::numeric, 7260.00::numeric)$$,
  'quitar: el cajero aplica 0 aunque se sugería 5 %'
);
insert into t_s select 'A6t', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 6, '30')), jsonb_build_array(pg_temp.pay('debit', 5082)))).id;
select is((select discount_amount from public.sale_items where sale_id = pg_temp.vid('A6t')), 2178.00::numeric, 'hasta el tope: 30 % de 7.260 = 2.178');
-- Una línea sin sugerido también puede llevar descuento a mano.
insert into t_s select 'A1m', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 1, '10')), jsonb_build_array(pg_temp.pay('debit', 1089)))).id;
select results_eq(
  $$select suggested_discount_percent, discount_percent, line_total from public.sale_items where sale_id = pg_temp.vid('A1m')$$,
  $$values (0.00::numeric, 10.00::numeric, 1089.00::numeric)$$,
  'una unidad no sugiere nada, pero se puede descontar a mano (P-42)'
);
-- Cantidades grandes: tope del sugerido.
insert into t_s select 'A36', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 36)), jsonb_build_array(pg_temp.pay('debit', 30492)))).id;
select is((select discount_percent from public.sale_items where sale_id = pg_temp.vid('A36')), 30.00::numeric, '36 unidades: 30 %');
select is((select line_total from public.sale_items where sale_id = pg_temp.vid('A36')), 30492.00::numeric, '36 unidades: línea 30.492');
insert into t_s select 'A60', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 60)), jsonb_build_array(pg_temp.pay('debit', 50820)))).id;
select is((select discount_percent from public.sale_items where sale_id = pg_temp.vid('A60')), 30.00::numeric, '60 unidades: el tope se mantiene en 30 %');
-- Por kilo: sugerido 0 (P-43); a mano sí.
insert into t_s select 'K6', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DK', 6)), jsonb_build_array(pg_temp.pay('debit', 53040)))).id;
select results_eq(
  $$select suggested_discount_percent, discount_percent, line_total from public.sale_items where sale_id = pg_temp.vid('K6')$$,
  $$values (0.00::numeric, 0.00::numeric, 53040.00::numeric)$$,
  '6 kg: sin descuento sugerido (P-43)'
);
insert into t_s select 'K6m', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DK', 6, '10')), jsonb_build_array(pg_temp.pay('debit', 47736)))).id;
select is((select discount_amount from public.sale_items where sale_id = pg_temp.vid('K6m')), 5304.00::numeric, 'por kilo, el cajero puede aplicar 10 % a mano');
-- Cajas (unidad entera): 6 -> 5 %.
insert into t_s select 'B6', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DB', 6)), jsonb_build_array(pg_temp.pay('debit', 3448.50)))).id;
select is((select discount_amount from public.sale_items where sale_id = pg_temp.vid('B6')), 181.50::numeric, 'cajas: 6 -> 5 % de 3.630 = 181,50');

-- El descuento va antes del redondeo: 6.897 pagado en efectivo como 6.900 (+3).
insert into t_s select 'A6r', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 6)), jsonb_build_array(pg_temp.pay('cash', 6900, 7000)))).id;
select is((select rounding_amount from public.sales where id = pg_temp.vid('A6r')), 3.00::numeric, 'el redondeo se calcula sobre el total ya descontado (6.897 -> 6.900)');

-- Líneas repetidas: se suman antes del sugerido; con porcentajes distintos es un error.
insert into t_s select 'R33', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 3), pg_temp.it('DA', 3)), jsonb_build_array(pg_temp.pay('debit', 6897)))).id;
select results_eq(
  $$select quantity, discount_percent from public.sale_items where sale_id = pg_temp.vid('R33')$$,
  $$values (6.000::numeric, 5.00::numeric)$$,
  'líneas repetidas: 3 + 3 = 6 unidades, sugerido 5 %'
);
insert into t_s select 'R33s', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 3, '10'), pg_temp.it('DA', 3, '10')), jsonb_build_array(pg_temp.pay('debit', 6534)))).id;
select is((select discount_percent from public.sale_items where sale_id = pg_temp.vid('R33s')), 10.00::numeric, 'líneas repetidas con el mismo porcentaje: se aplica');
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('DA', 3, '10'), pg_temp.it('DA', 3, '20')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'líneas repetidas con porcentajes distintos -> INVALID_DISCOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('DA', 3), pg_temp.it('DA', 3, '10')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'una línea sin porcentaje y otra con porcentaje -> INVALID_DISCOUNT'
);

-- Porcentajes inválidos.
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, '30.01')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'por encima del tope (30,01) -> INVALID_DISCOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, '-1')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'porcentaje negativo -> INVALID_DISCOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, '10.005')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'más de 2 decimales -> INVALID_DISCOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, '100')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', '100 % -> INVALID_DISCOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, '"abc"')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'porcentaje que no es número -> INVALID_DISCOUNT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, 'true')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'porcentaje booleano -> INVALID_DISCOUNT'
);
select lives_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 1, 'null')), jsonb_build_array(pg_temp.pay('debit', 1210)))$$,
  'discount_percent null equivale a no enviarlo'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6)), jsonb_build_array(pg_temp.pay('debit', 7260)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'el pago tiene que cerrar con el total YA descontado (7.260 por 6.897 supera el límite)'
);

-- ---------------------------------------------------------------------------
-- Idempotencia
-- ---------------------------------------------------------------------------
insert into t_s select 'I1', (public.register_sale('dddddddd-dddd-4ddd-8ddd-dddddddddd01', pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('DA', 6)), jsonb_build_array(pg_temp.pay('debit', 6897)))).id;
select is(
  (select id from public.register_sale('dddddddd-dddd-4ddd-8ddd-dddddddddd01', pg_temp.sid('S1'),
    jsonb_build_array(pg_temp.it('DA', 6)), jsonb_build_array(pg_temp.pay('debit', 6897)))),
  pg_temp.vid('I1'), 'reintento idéntico (sin porcentaje) devuelve la misma venta'
);
select throws_ok(
  $$select public.register_sale('dddddddd-dddd-4ddd-8ddd-dddddddddd01', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('DA', 6, '5')), jsonb_build_array(pg_temp.pay('debit', 6897)))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la misma clave con el porcentaje enviado explícito es otra solicitud -> IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.register_sale('dddddddd-dddd-4ddd-8ddd-dddddddddd01', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('DA', 6, '10')), jsonb_build_array(pg_temp.pay('debit', 6534)))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la misma clave con otro porcentaje -> IDEMPOTENCY_CONFLICT'
);
reset role;

-- Cambiar la configuración NO rompe el reintento de una venta ya hecha (el hash usa lo que mandó el cliente).
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000db", "role": "authenticated"}', true);
set local role authenticated;
update public.sales_settings set quantity_discount_max_percent = 10;
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000dc", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select id from public.register_sale('dddddddd-dddd-4ddd-8ddd-dddddddddd01', pg_temp.sid('S1'),
    jsonb_build_array(pg_temp.it('DA', 6)), jsonb_build_array(pg_temp.pay('debit', 6897)))),
  pg_temp.vid('I1'), 'el reintento devuelve la misma venta aunque haya cambiado el tope'
);
-- Con tope 10 %: el sugerido de 36 unidades baja a 10 % y 15 % ya no vale.
reset role;
select is(private.suggested_discount(36, 'unit', 6, 5, 10), 10::numeric, 'el tope configurable limita el sugerido');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000dc", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('DA', 6, '15')), jsonb_build_array(pg_temp.pay('debit', 5000)))$$,
  'P0001', 'INVALID_DISCOUNT', 'con tope 10 %, el cajero no puede poner 15 %'
);
reset role;
select is((select quantity_discount_max_percent from public.sales_settings), 10.00::numeric, 'el tope quedó en 10 (lo cambió el encargado)');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000db", "role": "authenticated"}', true);
set local role authenticated;
update public.sales_settings set quantity_discount_max_percent = 30;
reset role;

-- La empleada no cambia la regla; los límites de la regla los protege la base.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000dc", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$update public.sales_settings set quantity_discount_step = 1$$, 'la empleada que intenta cambiar la regla no recibe error (la RLS filtra)');
reset role;
select is((select quantity_discount_step from public.sales_settings), 6, 'la regla sigue en 6 unidades');
select throws_ok($$update public.sales_settings set quantity_discount_max_percent = 100$$, '23514', null, 'el tope no puede ser 100 %');
select throws_ok($$update public.sales_settings set quantity_discount_percent = 100$$, '23514', null, 'el escalón no puede ser 100 %');
select throws_ok($$update public.sales_settings set quantity_discount_step = 0$$, '23514', null, 'el paso tiene que ser mayor que 0');
select throws_ok($$update public.sales_settings set quantity_discount_max_percent = -1$$, '23514', null, 'el tope no puede ser negativo');

-- ---------------------------------------------------------------------------
-- Invariantes de §15 y §16 en todas las ventas de esta prueba
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.sales s
    where s.id in (select id from t_s)
      and (s.total_amount <> (select sum(i.line_total) from public.sale_items i where i.sale_id = s.id)
        or s.discount_total <> (select sum(i.discount_amount) from public.sale_items i where i.sale_id = s.id)
        or (select sum(p.amount) from public.sale_payments p where p.sale_id = s.id) <> s.total_amount + s.rounding_amount)),
  0, 'Σ line_total = total, Σ descuentos = discount_total y Σ pagos = total + redondeo en toda venta'
);
select is(
  (select count(*)::int from public.sale_items i
    where i.sale_id in (select id from t_s) and i.line_total + i.discount_amount <> i.list_line_total),
  0, 'line_total + discount_amount = list_line_total en todo ítem'
);
select is(
  (select count(*)::int from public.sale_items i
    where i.sale_id in (select id from t_s) and i.discount_percent > 30),
  0, 'ningún ítem supera el tope de 30 %'
);

-- Inmutabilidad de las columnas nuevas.
select throws_ok($$update public.sale_items set discount_percent = 0$$, '42501', null, 'el descuento de un ítem no se edita');
select throws_ok($$update public.sales set discount_total = 0 where id = (select id from t_s limit 1)$$, '42501', null, 'discount_total de una venta no se edita');
select throws_ok(
  $$insert into public.sale_items (sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
      unit_cost_price, product_sku, product_name, list_line_total, discount_percent, discount_amount)
    select sale_id, product_id, 1, 100, 21, 90, 74.38, 15.62, 10, 'x', 'x', 100, 10, 5 from public.sale_items limit 1$$,
  '23514', null, 'CHECK: línea + descuento tiene que dar el valor de lista'
);

-- Venta inconsistente a mano: el total de descuentos tiene que coincidir con los ítems.
insert into public.sales (id, idempotency_key, request_hash, cash_session_id, total_amount, net_amount, vat_amount, discount_total, rounding_amount, rounding_multiple, created_by)
values ('00000000-0000-4000-8000-0000000000f2', gen_random_uuid(), 'x', pg_temp.sid('S1'), 100, 100, 0, 50, 0, 100, '00000000-0000-4000-8000-0000000000dc');
select throws_ok($$set constraints sales_consistency_check immediate$$, '23514', null, 'una venta con descuentos que no coinciden no se puede confirmar');

-- ---------------------------------------------------------------------------
-- Anulación de una venta con descuento
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000db", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.stock_of('DB'), 44::numeric, 'DB: 50 - 6 vendidas');
select is((select status::text from public.void_sale(gen_random_uuid(), pg_temp.vid('B6'), 'Prueba de anulación con descuento')), 'voided', 'el encargado anula B6');
select is(pg_temp.stock_of('DB'), 50::numeric, 'la anulación devuelve las 6 cajas');
reset role;

-- ---------------------------------------------------------------------------
-- Vistas diarias
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000db", "role": "authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select sales_count, voided_count, total_amount, net_amount, vat_amount, discount_total, rounding_total, cost_total, gross_margin
    from public.v_sales_daily where sale_date = private.today_ar()$$,
  $$select
      (count(*) filter (where s.status = 'completed'))::int,
      (count(*) filter (where s.status = 'voided'))::int,
      coalesce(sum(s.total_amount) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum(s.net_amount) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum(s.vat_amount) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum(s.discount_total) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum(s.rounding_amount) filter (where s.status = 'completed'), 0)::numeric(12,2),
      coalesce(sum((select sum(round(i.quantity * i.unit_cost_price, 2)) from public.sale_items i where i.sale_id = s.id))
        filter (where s.status = 'completed'), 0)::numeric(12,2),
      (coalesce(sum(s.net_amount) filter (where s.status = 'completed'), 0)
        - coalesce(sum((select sum(round(i.quantity * i.unit_cost_price, 2)) from public.sale_items i where i.sale_id = s.id))
            filter (where s.status = 'completed'), 0))::numeric(12,2)
    from public.sales s
    where (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = private.today_ar()$$,
  'v_sales_daily de hoy coincide con el cálculo directo sobre las tablas (el encargado ve todo)'
);
select is(
  (select voided_count from public.v_sales_daily where sale_date = private.today_ar()),
  (select n + 1 from t_base where k = 'voided_today'), 'v_sales_daily cuenta la venta anulada solo en voided_count'
);
select ok(
  (select gross_margin from public.v_sales_daily where sale_date = private.today_ar())
    = (select net_amount - cost_total from public.v_sales_daily where sale_date = private.today_ar()),
  'margen bruto = neto - costo'
);
select is(
  (select discount_total from public.v_sales_daily where sale_date = private.today_ar()) > 0,
  true, 'los descuentos de hoy aparecen en la vista'
);
select results_eq(
  $$select payments_count, amount_total from public.v_sales_daily_payments
    where sale_date = private.today_ar() and payment_method_code = 'cash'$$,
  $$select count(*)::int, coalesce(sum(p.amount), 0)::numeric(12,2)
    from public.sale_payments p join public.sales s on s.id = p.sale_id
    where s.status = 'completed' and p.payment_method_id = pg_temp.mid('cash')
      and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = private.today_ar()$$,
  'v_sales_daily_payments: efectivo de hoy coincide con el cálculo directo'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000dc", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.v_sales_daily), 0, 'la empleada no ve filas de v_sales_daily');
select is((select count(*)::int from public.v_sales_daily_payments), 0, 'la empleada no ve filas de v_sales_daily_payments');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000da", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.v_sales_daily where sale_date = private.today_ar()), 1, 'el dueño ve las métricas');
reset role;

set local role anon;
select throws_ok($$select * from public.v_sales_daily$$, '42501', null, 'anon no lee v_sales_daily');
select throws_ok($$select * from public.v_sales_daily_payments$$, '42501', null, 'anon no lee v_sales_daily_payments');
reset role;

-- Conciliación del stock.
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0, 'conciliación: ningún lote descuadrado'
);

select * from finish();
rollback;
