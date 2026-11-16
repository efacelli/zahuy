-- Ranking de productos vendidos (contrato v0.8.0, §17). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Función y permisos
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'product_sales_ranking'
      and p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'] and p.proretset),
  1, 'product_sales_ranking es STABLE, SECURITY DEFINER, con search_path vacío y devuelve un conjunto'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'product_sales_ranking'),
  'p_from date, p_to date', 'firma del contrato'
);
select is(
  (select has_function_privilege('anon', p.oid, 'execute') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'product_sales_ranking'),
  false, 'anon no ejecuta product_sales_ranking'
);
select is(
  (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'product_sales_ranking'),
  true, 'authenticated sí tiene EXECUTE (el rol se valida adentro)'
);
select is(
  (select array_agg(a order by o)::text from (
     select unnest(p.proargnames) a, generate_series(1, array_length(p.proargnames, 1)) o
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'product_sales_ranking') x
   where o > 2),
  '{product_id,sku,name,brand_name,category_name,supplier_name,sale_unit,quantity_sold,sales_count,revenue_total,net_total,cost_total,gross_margin,last_sold_at,stock_quantity,product_created_at}',
  'devuelve las 16 columnas del contrato, en orden'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'dora.duena.rank@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'enzo.encargado.rank@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'eva.empleada.rank@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'ivan.inactivo.rank@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000a5', 'paco.programador.rank@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000a1';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000a2';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000a4';
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-0000000000a5';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000f0c1', 'Categoría ranking');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000f0b1', 'Marca ranking');
insert into public.suppliers (id, name) values ('00000000-0000-4000-8000-00000000f0d1', 'Proveedor ranking');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_c (code text primary key, id uuid) on commit drop;
create temporary table t_s (code text primary key, id uuid) on commit drop;
grant all on t_p, t_c, t_s to authenticated;

create function pg_temp.pid(p text) returns uuid language sql as $$ select id from t_p where code = p $$;
create function pg_temp.sid(c text) returns uuid language sql as $$ select id from t_c where code = c $$;
create function pg_temp.vid(c text) returns uuid language sql as $$ select id from t_s where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
create function pg_temp.it(p text, q numeric) returns jsonb language sql as
  $$ select jsonb_build_object('product_id', pg_temp.pid(p), 'quantity', q) $$;
create function pg_temp.debit(a numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid('debit'), 'amount', a, 'tendered_amount', null)) $$;
grant execute on function pg_temp.pid(text), pg_temp.sid(text), pg_temp.vid(text), pg_temp.mid(text),
  pg_temp.it(text, numeric), pg_temp.debit(numeric) to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
set local role authenticated;
-- RA 1.210 (unidad, con proveedor); RB por kilo 8.840; RC sin ventas; RD se vende y se desactiva; RE 605, solo en la venta 2.
insert into t_p select 'RA', (public.create_product(gen_random_uuid(), 'Rank RA fideos', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'unit', 100, 1000, 21, p_supplier_id => '00000000-0000-4000-8000-00000000f0d1',
  p_initial_quantity => 400, p_expires_on => private.today_ar() + 90)).id;
insert into t_p select 'RB', (public.create_product(gen_random_uuid(), 'Rank RB jamón', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'kg', 5000, 8000, 10.5, p_initial_quantity => 50, p_expires_on => private.today_ar() + 30)).id;
insert into t_p select 'RC', (public.create_product(gen_random_uuid(), 'Rank RC sin ventas', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'unit', 10, 100, 21, p_initial_quantity => 30, p_expires_on => private.today_ar() + 60)).id;
insert into t_p select 'RD', (public.create_product(gen_random_uuid(), 'Rank RD discontinuado', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'unit', 10, 100, 21, p_initial_quantity => 30, p_expires_on => private.today_ar() + 60)).id;
insert into t_p select 'RE', (public.create_product(gen_random_uuid(), 'Rank RE cajas', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'box', 100, 500, 21, p_initial_quantity => 40, p_expires_on => private.today_ar() + 60)).id;

insert into t_c select 'S1', (public.open_cash_session(gen_random_uuid(),
  (select id from public.cash_registers where name = 'Caja 1'), 0)).id;

-- Venta 1: RA x2 (2.420) + RB x0,350 kg (3.094) = 5.514.
insert into t_s select 'V1', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('RA', 2), pg_temp.it('RB', 0.35)), pg_temp.debit(5514))).id;
-- Venta 2: RA x6 con 5 % sugerido (6.897) + RE x1 (605) = 7.502.
insert into t_s select 'V2', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('RA', 6), pg_temp.it('RE', 1)), pg_temp.debit(7502))).id;
-- Venta 3: RA x10 (11.495 con 5 %) que se anula; y RD x3 (363).
insert into t_s select 'V3', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('RA', 10)), pg_temp.debit(11495))).id;
select public.void_sale(gen_random_uuid(), pg_temp.vid('V3'), 'Prueba: no debe contar en el ranking');
insert into t_s select 'V4', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('RD', 3)), pg_temp.debit(363))).id;
update public.products set is_active = false where id = pg_temp.pid('RD');
reset role;

-- Las fechas de las ventas se mueven a mano (solo en esta prueba): created_at es de solo lectura para la app.
set constraints all immediate;
alter table public.sales disable trigger sales_guard;
-- V1: hoy a las 00:00 (hora local, primer instante del día). V2: hace 5 días a las 23:30 (último minuto de ese día).
update public.sales set created_at = (private.today_ar()::timestamp) at time zone 'America/Argentina/Buenos_Aires'
  where id = pg_temp.vid('V1');
update public.sales set created_at = ((private.today_ar() - 5)::timestamp + interval '23 hours 30 minutes') at time zone 'America/Argentina/Buenos_Aires'
  where id = pg_temp.vid('V2');
alter table public.sales enable trigger sales_guard;

-- ---------------------------------------------------------------------------
-- Permisos por rol
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.product_sales_ranking(current_date - 7, current_date)$$, 'P0001', 'NOT_AUTHORIZED', 'la empleada recibe NOT_AUTHORIZED');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.product_sales_ranking(current_date - 7, current_date)$$, 'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo recibe NOT_AUTHORIZED (aunque su rol sea encargado)');
reset role;
set local role anon;
select throws_ok($$select * from public.product_sales_ranking(current_date - 7, current_date)$$, '42501', null, 'anon no ejecuta el ranking');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.product_sales_ranking(private.today_ar() - 7, private.today_ar())) > 0, 'el dueño ve el ranking');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a5", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.product_sales_ranking(private.today_ar() - 7, private.today_ar())) > 0, 'el programador ve el ranking');
reset role;

-- ---------------------------------------------------------------------------
-- Encargado: rangos, filas y cuentas
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok($$select * from public.product_sales_ranking(null, private.today_ar())$$, 'P0001', 'INVALID_DATE_RANGE', 'p_from nulo -> INVALID_DATE_RANGE');
select throws_ok($$select * from public.product_sales_ranking(private.today_ar(), null)$$, 'P0001', 'INVALID_DATE_RANGE', 'p_to nulo -> INVALID_DATE_RANGE');
select throws_ok($$select * from public.product_sales_ranking(private.today_ar(), private.today_ar() - 1)$$, 'P0001', 'INVALID_DATE_RANGE', 'rango invertido -> INVALID_DATE_RANGE');
select throws_ok($$select * from public.product_sales_ranking(private.today_ar() - 366, private.today_ar())$$, 'P0001', 'INVALID_DATE_RANGE', '367 días -> INVALID_DATE_RANGE');
select lives_ok($$select * from public.product_sales_ranking(private.today_ar() - 365, private.today_ar())$$, '366 días exactos es válido');
select lives_ok($$select * from public.product_sales_ranking(private.today_ar(), private.today_ar())$$, 'un solo día es válido');

-- Rango [hoy-7, hoy]: V1 (hoy 00:00) y V2 (hace 5 días 23:30) adentro.
select results_eq(
  $$select quantity_sold, sales_count, revenue_total, net_total, cost_total, gross_margin
    from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RA')$$,
  $$values (8.000::numeric, 2, 9317.00::numeric, 7700.00::numeric, 800.00::numeric, 6900.00::numeric)$$,
  'RA: 8 u. en 2 ventas, 9.317 con IVA (después del descuento), neto 7.700, costo 800, margen 6.900; la venta anulada no cuenta'
);
select results_eq(
  $$select quantity_sold, sales_count, revenue_total, net_total, cost_total, gross_margin
    from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RB')$$,
  $$values (0.350::numeric, 1, 3094.00::numeric, 2800.00::numeric, 1750.00::numeric, 1050.00::numeric)$$,
  'RB: 0,350 kg con decimales, costo = round(0,35 * 5.000, 2)'
);
select results_eq(
  $$select quantity_sold, sales_count, revenue_total, net_total, cost_total, gross_margin, last_sold_at
    from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RC')$$,
  $$values (0.000::numeric, 0, 0.00::numeric, 0.00::numeric, 0.00::numeric, 0.00::numeric, null::timestamptz)$$,
  'RC (nunca vendido): aparece con ceros y last_sold_at nulo'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RD')),
  0, 'el producto inactivo (RD) no aparece aunque vendió en el período (P-47)'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 7, private.today_ar())
    where product_id not in (select id from public.products where is_active)),
  0, 'solo hay productos activos'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 7, private.today_ar())),
  (select count(*)::int from public.products where is_active),
  'una fila por producto activo'
);
select is(
  (select supplier_name from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RA')),
  'Proveedor ranking', 'trae el proveedor'
);
select is(
  (select supplier_name from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RB')),
  null::text, 'sin proveedor -> nulo'
);
select results_eq(
  $$select brand_name, category_name, sku, name, sale_unit::text
    from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RB')$$,
  $$select b.name, c.name, p.sku, p.name, p.sale_unit::text from public.products p
    join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id where p.id = pg_temp.pid('RB')$$,
  'marca, categoría, SKU, nombre y unidad son los del producto'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) r
    where r.product_created_at is distinct from (select p.created_at from public.products p where p.id = r.product_id)),
  0, 'product_created_at es products.created_at'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) r
    where r.gross_margin <> r.net_total - r.cost_total),
  0, 'gross_margin = net_total - cost_total en toda fila'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) r
    where r.stock_quantity is distinct from (select coalesce(sum(b.quantity_available), 0) from public.product_batches b where b.product_id = r.product_id)),
  0, 'stock_quantity es la suma de los lotes (v_product_stock)'
);
select is(
  (select stock_quantity from public.product_sales_ranking(private.today_ar() - 7, private.today_ar()) where product_id = pg_temp.pid('RA')),
  392.000::numeric, 'RA: 400 - 2 - 6 (la venta anulada devolvió sus 10)'
);

-- Extremos del rango con hora local.
select is(
  (select quantity_sold from public.product_sales_ranking(private.today_ar() - 5, private.today_ar() - 5) where product_id = pg_temp.pid('RA')),
  6.000::numeric, 'la venta de las 23:30 del último día entra en [d, d] (extremo superior incluido)'
);
select is(
  (select quantity_sold from public.product_sales_ranking(private.today_ar() - 5, private.today_ar() - 5) where product_id = pg_temp.pid('RB')),
  0.000::numeric, 'otra venta (hoy) no entra en un rango de otro día'
);
select is(
  (select quantity_sold from public.product_sales_ranking(private.today_ar() - 4, private.today_ar()) where product_id = pg_temp.pid('RA')),
  2.000::numeric, 'un rango que empieza al día siguiente excluye la venta de las 23:30'
);
select is(
  (select quantity_sold from public.product_sales_ranking(private.today_ar(), private.today_ar()) where product_id = pg_temp.pid('RA')),
  2.000::numeric, 'la venta de las 00:00 de hoy entra en [hoy, hoy] (extremo inferior incluido)'
);
select is(
  (select quantity_sold from public.product_sales_ranking(private.today_ar() - 1, private.today_ar() - 1) where product_id = pg_temp.pid('RA')),
  0.000::numeric, 'la venta de las 00:00 de hoy no entra en el día anterior'
);

-- "Sin ventas en X días": RE solo vendió hace 5 días; en los últimos 3 figura sin ventas pero con su última venta.
select results_eq(
  $$select quantity_sold, last_sold_at is not null, last_sold_at = (select s.created_at from public.sales s where s.id = pg_temp.vid('V2'))
    from public.product_sales_ranking(private.today_ar() - 3, private.today_ar()) where product_id = pg_temp.pid('RE')$$,
  $$values (0.000::numeric, true, true)$$,
  'RE: sin ventas en los últimos 3 días, y last_sold_at es de siempre (la venta de hace 5 días)'
);
select is(
  (select count(*)::int from public.product_sales_ranking(private.today_ar() - 3, private.today_ar())
    where quantity_sold = 0 and stock_quantity > 0 and product_created_at < (private.today_ar() - 3)::timestamp),
  0, 'los productos recién cargados quedan fuera del filtro "sin ventas" (product_created_at)'
);

reset role;

select * from finish();
rollback;
