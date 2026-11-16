-- Historial de precios y aumentos masivos (contrato v0.9.x, §19). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura y seguridad
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public' and t.tablename in ('price_history', 'price_bulk_changes') and t.rowsecurity),
  2, 'price_history y price_bulk_changes tienen RLS activada'
);
select is(
  (select count(*)::int from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('price_history', 'price_bulk_changes')
      and g.grantee = 'anon'),
  0, 'anon no tiene permisos sobre las tablas de precios'
);
select is(
  (select count(*)::int from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('price_history', 'price_bulk_changes')
      and g.grantee = 'authenticated' and g.privilege_type <> 'SELECT'),
  0, 'authenticated solo puede leer las tablas de precios (se escriben por trigger y RPC)'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('preview_price_increase', 'apply_price_increase', 'revert_price_change')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'las 3 funciones son SECURITY DEFINER con search_path vacío'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'EXECUTE de todas las funciones de public: solo authenticated'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'apply_price_increase'),
  'p_idempotency_key uuid, p_brand_ids uuid[], p_supplier_ids uuid[], p_category_ids uuid[], p_product_ids uuid[], '
  || 'p_percent numeric, p_rounding_multiple numeric, p_excluded_product_ids uuid[], p_notes text',
  'apply_price_increase tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'preview_price_increase'),
  'p_brand_ids uuid[], p_supplier_ids uuid[], p_category_ids uuid[], p_product_ids uuid[], p_percent numeric, p_rounding_multiple numeric',
  'preview_price_increase tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'revert_price_change'),
  'p_idempotency_key uuid, p_bulk_change_id uuid, p_reason text', 'revert_price_change tiene los parámetros del contrato'
);
select is(
  (select provolatile::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'preview_price_increase'),
  's', 'preview_price_increase es STABLE (solo lectura)'
);

-- Regla de precio (round_price): exacto bajo la mitad del múltiplo, desde la mitad sube.
select is(private.round_price(1331, 10), 1330::numeric, 'round_price 1.331 con múltiplo 10 -> 1.330');
select is(private.round_price(1335, 10), 1340::numeric, 'round_price 1.335 -> 1.340 (desde la mitad sube)');
select is(private.round_price(4.39, 10), 4.39::numeric, 'round_price: bajo la mitad del múltiplo queda exacto (4,39)');
select is(private.round_price(5, 10), 10::numeric, 'round_price: justo la mitad sube (5 -> 10)');
select is(private.round_price(14.99, 10), 10::numeric, 'round_price 14,99 -> 10');
select is(private.round_price(15, 10), 20::numeric, 'round_price 15 -> 20');
select is(private.round_price(1331, null), 1331::numeric, 'round_price sin múltiplo -> exacto');
select is(private.price_increase_final(1000, 21, 10, null), 1331.00::numeric, 'precio final +10 % de 1.000 sin IVA con IVA 21 = 1.331');
select is(private.price_increase_final(1000, 21, 10, 10), 1330::numeric, 'con múltiplo 10 = 1.330');

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'dora.duena.pre@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'enzo.encargado.pre@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'eva.empleada.pre@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000c4', 'ivan.inactivo.pre@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000c5', 'paco.programador.pre@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000c1';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000c2';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000c4';
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-0000000000c5';

insert into public.brands (id, name) values
  ('00000000-0000-4000-8000-00000000a0b1', 'Marca BA precios'),
  ('00000000-0000-4000-8000-00000000a0b2', 'Marca BB precios'),
  ('00000000-0000-4000-8000-00000000a0b3', 'Marca BC precios');
insert into public.categories (id, name) values
  ('00000000-0000-4000-8000-00000000a0c1', 'Categoría CA precios'),
  ('00000000-0000-4000-8000-00000000a0c2', 'Categoría CB precios');
insert into public.suppliers (id, name) values ('00000000-0000-4000-8000-00000000a0d1', 'Proveedor SA precios');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_b (code text primary key, id uuid) on commit drop;
grant all on t_p, t_b to authenticated;
create function pg_temp.pid(c text) returns uuid language sql as $$ select id from t_p where code = c $$;
create function pg_temp.bid(c text) returns uuid language sql as $$ select id from t_b where code = c $$;
grant execute on function pg_temp.pid(text), pg_temp.bid(text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
-- P1 (BA, CA, SA) 1.210; P2 (BA, CB) 605; P3 (BB, CA, SA) 1.000 con precio de 4 decimales; P4 (BA, CA) 110,50 con IVA 10,5;
-- P5 (BA, CA) que se desactiva; P6 (BA, CB) barato (3,99).
insert into t_p select 'P1', (public.create_product(gen_random_uuid(), 'Precio P1', '00000000-0000-4000-8000-00000000a0c1',
  '00000000-0000-4000-8000-00000000a0b1', 'unit', 100, 1000, 21, p_supplier_id => '00000000-0000-4000-8000-00000000a0d1')).id;
insert into t_p select 'P2', (public.create_product(gen_random_uuid(), 'Precio P2', '00000000-0000-4000-8000-00000000a0c2',
  '00000000-0000-4000-8000-00000000a0b1', 'unit', 50, 500, 21)).id;
insert into t_p select 'P3', (public.create_product(gen_random_uuid(), 'Precio P3', '00000000-0000-4000-8000-00000000a0c1',
  '00000000-0000-4000-8000-00000000a0b2', 'unit', 300, 826.4463, 21, p_supplier_id => '00000000-0000-4000-8000-00000000a0d1')).id;
insert into t_p select 'P4', (public.create_product(gen_random_uuid(), 'Precio P4', '00000000-0000-4000-8000-00000000a0c1',
  '00000000-0000-4000-8000-00000000a0b1', 'unit', 50, 100, 10.5)).id;
insert into t_p select 'P5', (public.create_product(gen_random_uuid(), 'Precio P5', '00000000-0000-4000-8000-00000000a0c1',
  '00000000-0000-4000-8000-00000000a0b1', 'unit', 80, 200, 21)).id;
insert into t_p select 'P6', (public.create_product(gen_random_uuid(), 'Precio P6', '00000000-0000-4000-8000-00000000a0c2',
  '00000000-0000-4000-8000-00000000a0b1', 'unit', 1, 3.2975, 21)).id;
update public.products set is_active = false where id = pg_temp.pid('P5');
reset role;

select is((select sale_price_with_vat from public.products where id = pg_temp.pid('P1')), 1210.00::numeric, 'P1: precio final 1.210');
select is((select sale_price_with_vat from public.products where id = pg_temp.pid('P3')), 1000.00::numeric, 'P3: precio final 1.000 (4 decimales exactos)');
select is((select sale_price_with_vat from public.products where id = pg_temp.pid('P6')), 3.99::numeric, 'P6: precio final 3,99');
select is(
  (select count(*)::int from public.price_history where product_id in (select id from t_p)),
  0, 'dar de alta un producto no es un cambio de precio: sin historial'
);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c3", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)$$, 'P0001', 'NOT_AUTHORIZED', 'la empleada no ve la vista previa');
select throws_ok($$select public.apply_price_increase(gen_random_uuid(), '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)$$, 'P0001', 'NOT_AUTHORIZED', 'la empleada no aplica aumentos');
select throws_ok($$select public.revert_price_change(gen_random_uuid(), gen_random_uuid(), 'x')$$, 'P0001', 'NOT_AUTHORIZED', 'la empleada no deshace aumentos');
select is((select count(*)::int from public.price_history), 0, 'la empleada no lee price_history');
select is((select count(*)::int from public.price_bulk_changes), 0, 'la empleada no lee price_bulk_changes');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c4", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)$$, 'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo no ve la vista previa (aunque su rol sea encargado)');
reset role;
set local role anon;
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)$$, '42501', null, 'anon no ejecuta preview_price_increase');
select throws_ok($$select public.apply_price_increase(gen_random_uuid(), '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)$$, '42501', null, 'anon no ejecuta apply_price_increase');
select throws_ok($$select public.revert_price_change(gen_random_uuid(), gen_random_uuid(), 'x')$$, '42501', null, 'anon no ejecuta revert_price_change');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)) > 0, 'el dueño usa la vista previa');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c5", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)) > 0, 'el programador usa la vista previa');
reset role;

-- ---------------------------------------------------------------------------
-- Vista previa (encargado)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok($$select * from public.preview_price_increase(null, null, null, null, 10)$$, 'P0001', 'FILTER_REQUIRED', 'sin ningún filtro -> FILTER_REQUIRED (P-50)');
select throws_ok($$select * from public.preview_price_increase('{}', '{}', '{}', '{}', 10)$$, 'P0001', 'FILTER_REQUIRED', 'filtros vacíos -> FILTER_REQUIRED');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, null)$$, 'P0001', 'INVALID_PERCENT', 'porcentaje nulo -> INVALID_PERCENT');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 0)$$, 'P0001', 'INVALID_PERCENT', 'porcentaje 0 -> INVALID_PERCENT');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 50.001)$$, 'P0001', 'INVALID_PERCENT', '50,001 % -> INVALID_PERCENT (tope de 50 %)');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, -51)$$, 'P0001', 'INVALID_PERCENT', '-51 % -> INVALID_PERCENT');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10.1234)$$, 'P0001', 'INVALID_PERCENT', 'más de 3 decimales -> INVALID_PERCENT');
select lives_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 50)$$, '50 % es válido');
select lives_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, -50)$$, '-50 % es válido (baja)');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10, 0)$$, 'P0001', 'INVALID_ROUNDING', 'múltiplo 0 -> INVALID_ROUNDING');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10, -5)$$, 'P0001', 'INVALID_ROUNDING', 'múltiplo negativo -> INVALID_ROUNDING');
select throws_ok($$select * from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10, 10.001)$$, 'P0001', 'INVALID_ROUNDING', 'múltiplo con más de 2 decimales -> INVALID_ROUNDING');

-- Marca BA +10 %: solo productos ACTIVOS (P5 inactivo no aparece).
select results_eq(
  $$select p.code, r.old_sale_price, r.old_price_with_vat, r.new_sale_price, r.new_price_with_vat, r.change_amount
    from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10) r
    join t_p p on p.id = r.product_id where p.code in ('P1', 'P2', 'P4') order by p.code$$,
  $$values ('P1'::text, 1000.0000::numeric, 1210.00::numeric, 1100.0000::numeric, 1331.00::numeric, 121.00::numeric),
           ('P2', 500.0000, 605.00, 550.0000, 665.50, 60.50),
           ('P4', 100.0000, 110.50, 110.0000, 121.55, 11.05)$$,
  'marca BA +10 %: precio viejo y nuevo, con y sin IVA, y el cambio de góndola de cada producto'
);
select is(
  (select count(*)::int from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10) r
    where r.product_id = pg_temp.pid('P5')),
  0, 'el producto inactivo no aparece en la vista previa'
);
-- Los filtros se combinan con Y.
select is(
  (select array_agg(p.code order by p.code) from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, '{00000000-0000-4000-8000-00000000a0c1}', null, 10) r
    join t_p p on p.id = r.product_id where p.code like 'P%'),
  array['P1', 'P4'], 'marca BA Y categoría CA: P1 y P4 (P2 es de otra categoría, P5 está inactivo)'
);
select is(
  (select array_agg(p.code order by p.code) from public.preview_price_increase(null, '{00000000-0000-4000-8000-00000000a0d1}', null, null, 10) r
    join t_p p on p.id = r.product_id),
  array['P1', 'P3'], 'proveedor SA: P1 y P3'
);
select is(
  (select array_agg(p.code order by p.code) from public.preview_price_increase('{00000000-0000-4000-8000-00000000a0b1}', null, null, array[pg_temp.pid('P2'), pg_temp.pid('P3')], 10) r
    join t_p p on p.id = r.product_id),
  array['P2'], 'marca BA Y lista de productos [P2, P3]: solo P2 (P3 es de otra marca)'
);
select is(
  (select array_agg(p.code order by p.code) from public.preview_price_increase(null, null, null, array[pg_temp.pid('P1'), pg_temp.pid('P2'), pg_temp.pid('P3')], 10) r
    join t_p p on p.id = r.product_id),
  array['P1', 'P2', 'P3'], 'filtro solo por lista de productos'
);
-- Redondeo del precio final.
select results_eq(
  $$select r.new_price_with_vat, r.change_amount from public.preview_price_increase(null, null, null, array[pg_temp.pid('P1')], 10, 10) r$$,
  $$values (1330.00::numeric, 120.00::numeric)$$,
  'P1 +10 % con múltiplo 10: 1.331 se redondea a 1.330'
);
select is(
  (select r.new_price_with_vat from public.preview_price_increase(null, null, null, array[pg_temp.pid('P1')], 10, 10) r),
  (select round(r.new_sale_price * 1.21, 2) from public.preview_price_increase(null, null, null, array[pg_temp.pid('P1')], 10, 10) r),
  'el sale_price de 4 decimales reproduce el precio final redondeado al centavo (P-24)'
);
select results_eq(
  $$select r.new_price_with_vat from public.preview_price_increase(null, null, null, array[pg_temp.pid('P6')], 10, 10) r$$,
  $$values (4.39::numeric)$$,
  'P6 (3,99) +10 % con múltiplo 10: 4,39 queda exacto porque es menos de la mitad del múltiplo'
);
-- Producto sin cambio: se muestra con change_amount = 0.
select results_eq(
  $$select r.change_amount, r.new_price_with_vat, r.old_price_with_vat from public.preview_price_increase(null, null, null, array[pg_temp.pid('P4')], 0.001) r$$,
  $$values (0.00::numeric, 110.50::numeric, 110.50::numeric)$$,
  'un aumento que no cambia el precio final se muestra «sin cambio» (change_amount = 0)'
);
select is(
  (select count(*)::int from public.price_history where product_id in (select id from t_p)),
  0, 'la vista previa no escribe nada'
);
reset role;

-- ---------------------------------------------------------------------------
-- Aplicar (encargado)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.apply_price_increase(gen_random_uuid(), null, null, null, null, 10)$$, 'P0001', 'FILTER_REQUIRED', 'apply sin filtros -> FILTER_REQUIRED (nunca todo el catálogo)');
select throws_ok($$select public.apply_price_increase(gen_random_uuid(), '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 51)$$, 'P0001', 'INVALID_PERCENT', 'apply con 51 % -> INVALID_PERCENT');
select throws_ok($$select public.apply_price_increase(gen_random_uuid(), '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10, -1)$$, 'P0001', 'INVALID_ROUNDING', 'apply con múltiplo -1 -> INVALID_ROUNDING');
select throws_ok(
  $$select public.apply_price_increase(gen_random_uuid(), null, null, null, array[pg_temp.pid('P4')], 0.001)$$,
  'P0001', 'NO_PRODUCTS', 'un aumento que no cambia ningún precio -> NO_PRODUCTS'
);
select throws_ok(
  $$select public.apply_price_increase(gen_random_uuid(), '{00000000-0000-4000-8000-00000000a0b2}', null, '{00000000-0000-4000-8000-00000000a0c2}', null, 10)$$,
  'P0001', 'NO_PRODUCTS', 'filtros que no cumple ningún producto -> NO_PRODUCTS'
);
select is((select count(*)::int from public.price_bulk_changes), 0, 'los rechazos no dejan registro de aumento');

-- Aumento A1: marca BA +10 %, sin P2.
insert into t_b select 'A1', (public.apply_price_increase('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101',
  '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10, null, array[pg_temp.pid('P2')], 'Aumento de prueba')).id;
reset role;

select results_eq(
  $$select products_count, percent, rounding_multiple, status, notes, created_by, excluded_product_ids
    from public.price_bulk_changes where id = pg_temp.bid('A1')$$,
  $$values (3, 10.000::numeric, null::numeric, 'applied'::text, 'Aumento de prueba'::text,
            '00000000-0000-4000-8000-0000000000c2'::uuid, array[pg_temp.pid('P2')])$$,
  'A1: tres productos (P1, P4, P6; P2 excluido y P5 inactivo), 10 %, aplicado, con notas y quién'
);
select is((select sale_price from public.products where id = pg_temp.pid('P1')), 1100.0000::numeric, 'P1: sale_price 1.100');
select is((select sale_price_with_vat from public.products where id = pg_temp.pid('P1')), 1331.00::numeric, 'P1: precio final 1.331');
select is((select sale_price_with_vat from public.products where id = pg_temp.pid('P4')), 121.55::numeric, 'P4: precio final 121,55');
select is((select sale_price from public.products where id = pg_temp.pid('P2')), 500.0000::numeric, 'P2 (excluido) no cambió');
select is((select sale_price from public.products where id = pg_temp.pid('P5')), 200.0000::numeric, 'P5 (inactivo) no cambió');
select is((select sale_price from public.products where id = pg_temp.pid('P3')), 826.4463::numeric, 'P3 (otra marca) no cambió');
select is(
  (select array_agg(cost_price order by sku) from public.products where id in (pg_temp.pid('P1'), pg_temp.pid('P4'), pg_temp.pid('P6'))),
  (select array_agg(c order by s) from (values ('x1', 100.00::numeric), ('x2', 50.00), ('x3', 1.00)) v(s, c)),
  'los costos no se tocan (P-52)'
);
select results_eq(
  $$select h.source, h.bulk_change_id, h.old_sale_price, h.new_sale_price, h.old_cost_price = h.new_cost_price, h.changed_by, h.reason
    from public.price_history h where h.product_id = pg_temp.pid('P1')$$,
  $$values ('bulk_increase'::text, pg_temp.bid('A1'), 1000.0000::numeric, 1100.0000::numeric, true,
            '00000000-0000-4000-8000-0000000000c2'::uuid, 'Aumento de prueba'::text)$$,
  'P1: una fila de historial bulk_increase con el aumento, el antes y el después, quién y el motivo'
);
select is(
  (select count(*)::int from public.price_history where bulk_change_id = pg_temp.bid('A1')), 3,
  'el aumento dejó una fila por producto cambiado'
);

-- Idempotencia.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select id from public.apply_price_increase('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101',
    '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10, null, array[pg_temp.pid('P2')], 'otra nota')),
  pg_temp.bid('A1'), 'reintento con la misma clave y los mismos datos devuelve el mismo aumento'
);
select throws_ok(
  $$select public.apply_price_increase('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101', '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 20, null, array[pg_temp.pid('P2')])$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la misma clave con otro porcentaje -> IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.apply_price_increase('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c101', '{00000000-0000-4000-8000-00000000a0b1}', null, null, null, 10)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la misma clave sin la exclusión -> IDEMPOTENCY_CONFLICT'
);
reset role;
select is((select sale_price from public.products where id = pg_temp.pid('P1')), 1100.0000::numeric, 'el reintento no aplicó el aumento de nuevo');
select is((select count(*)::int from public.price_history where bulk_change_id = pg_temp.bid('A1')), 3, 'ni dejó más historial');

-- Ediciones manuales: también dejan historial, con origen manual.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
update public.products set sale_price = 826.4463 where id = pg_temp.pid('P3');
update public.products set sale_price = 900, cost_price = 310 where id = pg_temp.pid('P3');
update public.products set name = 'Precio P3 renombrado' where id = pg_temp.pid('P3');
update public.products set sale_price = 900 where id = pg_temp.pid('P3');
reset role;
select results_eq(
  $$select source, bulk_change_id, old_sale_price, new_sale_price, old_cost_price, new_cost_price from public.price_history
    where product_id = pg_temp.pid('P3') order by changed_at, new_sale_price$$,
  $$values ('manual'::text, null::uuid, 826.4463::numeric, 900.0000::numeric, 300.00::numeric, 310.00::numeric)$$,
  'la edición manual de precio y costo deja UNA fila manual; un UPDATE sin cambio de precio, o de otra columna, no deja fila'
);

-- El origen que llega al trigger se valida: un bulk_* sin aumento real queda como manual.
select set_config('app.price_change_source', 'bulk_increase', true);
select set_config('app.price_bulk_change_id', gen_random_uuid()::text, true);
update public.products set sale_price = 901 where id = pg_temp.pid('P3');
select set_config('app.price_change_source', 'bulk_revert', true);
select set_config('app.price_bulk_change_id', 'no-es-un-uuid', true);
update public.products set sale_price = 902 where id = pg_temp.pid('P3');
select set_config('app.price_change_source', '', true);
select set_config('app.price_bulk_change_id', '', true);
select is(
  (select count(*)::int from public.price_history where product_id = pg_temp.pid('P3') and source = 'manual' and bulk_change_id is null), 3,
  'un origen bulk_* con un id inexistente o mal formado se guarda como manual'
);
select is(
  (select count(*)::int from public.price_history where product_id = pg_temp.pid('P3') and source <> 'manual'), 0,
  'una edición manual nunca se etiqueta como parte de un aumento'
);
update public.products set sale_price = 826.4463, cost_price = 300 where id = pg_temp.pid('P3');

-- ---------------------------------------------------------------------------
-- Deshacer
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.revert_price_change(gen_random_uuid(), pg_temp.bid('A1'), '  ')$$, 'P0001', 'REASON_REQUIRED', 'deshacer sin motivo -> REASON_REQUIRED');
select throws_ok($$select public.revert_price_change(gen_random_uuid(), gen_random_uuid(), 'x')$$, 'P0001', 'PRICE_CHANGE_NOT_FOUND', 'aumento inexistente -> PRICE_CHANGE_NOT_FOUND');

create temporary table t_r (k text primary key, r jsonb) on commit drop;
grant all on t_r to authenticated;
insert into t_r select 'A1', public.revert_price_change('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d101', pg_temp.bid('A1'), 'Era un error');
select is((select (r ->> 'restored')::int from t_r where k = 'A1'), 3, 'deshacer A1: restaura los 3 productos');
select is((select r -> 'skipped_product_ids' from t_r where k = 'A1'), '[]'::jsonb, 'deshacer A1: no saltea ninguno');
select is(
  public.revert_price_change('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d101', pg_temp.bid('A1'), 'Otra nota'),
  (select r from t_r where k = 'A1'), 'reintento con la misma clave devuelve el mismo resultado'
);
select throws_ok($$select public.revert_price_change(gen_random_uuid(), pg_temp.bid('A1'), 'Otra vez')$$, 'P0001', 'ALREADY_REVERTED', 'deshacer dos veces con otra clave -> ALREADY_REVERTED');
select throws_ok($$select public.revert_price_change('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d101', gen_random_uuid(), 'x')$$, 'P0001', 'IDEMPOTENCY_CONFLICT', 'la clave de otro deshacer con otro aumento -> IDEMPOTENCY_CONFLICT');
reset role;
select is((select sale_price from public.products where id = pg_temp.pid('P1')), 1000.0000::numeric, 'P1 volvió a su precio');
select is((select sale_price_with_vat from public.products where id = pg_temp.pid('P4')), 110.50::numeric, 'P4 volvió a su precio');
select results_eq(
  $$select status, revert_reason, reverted_by from public.price_bulk_changes where id = pg_temp.bid('A1')$$,
  $$values ('reverted'::text, 'Era un error'::text, '00000000-0000-4000-8000-0000000000c2'::uuid)$$,
  'A1 queda como deshecho, con motivo y quién'
);
select is(
  (select count(*)::int from public.price_history where bulk_change_id = pg_temp.bid('A1') and source = 'bulk_revert'), 3,
  'cada producto restaurado dejó una fila bulk_revert'
);
select is(
  (select count(*)::int from public.price_history where bulk_change_id = pg_temp.bid('A1') and source = 'bulk_revert' and reason = 'Era un error'), 3,
  'las filas bulk_revert llevan el motivo'
);

-- Un bulk_revert sobre un aumento que YA se deshizo tampoco es válido: queda como manual.
select set_config('app.price_change_source', 'bulk_revert', true);
select set_config('app.price_bulk_change_id', pg_temp.bid('A1')::text, true);
update public.products set sale_price = 777 where id = pg_temp.pid('P3');
select set_config('app.price_change_source', '', true);
select set_config('app.price_bulk_change_id', '', true);
select is(
  (select source from public.price_history where product_id = pg_temp.pid('P3') and new_sale_price = 777),
  'manual', 'un bulk_revert sobre un aumento ya deshecho se guarda como manual'
);
update public.products set sale_price = 826.4463 where id = pg_temp.pid('P3');

-- Deshacer cuando un precio cambió después, y con un producto desactivado después.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
insert into t_b select 'A2', (public.apply_price_increase(gen_random_uuid(), null, null, null,
  array[pg_temp.pid('P1'), pg_temp.pid('P2'), pg_temp.pid('P6')], 20)).id;
update public.products set sale_price = 999 where id = pg_temp.pid('P1');
update public.products set is_active = false where id = pg_temp.pid('P2');
insert into t_r select 'A2', public.revert_price_change(gen_random_uuid(), pg_temp.bid('A2'), 'Revertir con cambios posteriores');
reset role;
select is((select (r ->> 'restored')::int from t_r where k = 'A2'), 2, 'A2: restaura P2 (aunque se desactivó después) y P6');
select is((select r -> 'skipped_product_ids' from t_r where k = 'A2'), to_jsonb(array[pg_temp.pid('P1')]), 'A2: saltea P1, que cambió de precio después, y lo informa');
select is((select sale_price from public.products where id = pg_temp.pid('P1')), 999.0000::numeric, 'nunca se pisa un precio posterior (P1 sigue en 999)');
select is((select sale_price from public.products where id = pg_temp.pid('P2')), 500.0000::numeric, 'P2 (inactivo) volvió a su precio');
select is((select is_active from public.products where id = pg_temp.pid('P2')), false, 'deshacer no reactiva productos');
update public.products set sale_price = 1000, is_active = true where id in (pg_temp.pid('P1'), pg_temp.pid('P2'));

-- ---------------------------------------------------------------------------
-- Atomicidad: si un producto no se puede actualizar, no se aplica ninguno
-- ---------------------------------------------------------------------------
insert into public.products (id, sku, name, category_id, brand_id, sale_unit, cost_price, sale_price, vat_rate)
values ('00000000-0000-4000-8000-00000000a0e7', 'ZZ0007', 'Precio P7 enorme', '00000000-0000-4000-8000-00000000a0c2',
        '00000000-0000-4000-8000-00000000a0b3', 'unit', 1, 80000000, 21);
insert into t_p values ('P7', '00000000-0000-4000-8000-00000000a0e7');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.apply_price_increase('e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e701', null, null, null, array[pg_temp.pid('P6'), pg_temp.pid('P7')], 50)$$,
  '22003', null, 'si un producto desborda el tipo del precio, el aumento falla entero'
);
reset role;
select is((select sale_price from public.products where id = pg_temp.pid('P6')), 3.2975::numeric, 'atómico: P6 no quedó modificado');
select is((select count(*)::int from public.price_bulk_changes where idempotency_key = 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e701'), 0, 'atómico: no quedó registro del aumento');

-- ---------------------------------------------------------------------------
-- Inmutabilidad y lectura
-- ---------------------------------------------------------------------------
select throws_ok($$update public.price_history set reason = 'x'$$, '42501', null, 'price_history no se edita');
select throws_ok($$delete from public.price_history$$, '42501', null, 'price_history no se borra');
select throws_ok($$truncate public.price_history$$, '42501', null, 'price_history no admite TRUNCATE');
select throws_ok($$update public.price_bulk_changes set percent = 5$$, '42501', null, 'un aumento masivo no se edita');
select throws_ok($$delete from public.price_bulk_changes$$, '42501', null, 'un aumento masivo no se borra');
insert into public.price_bulk_changes (id, idempotency_key, percent, products_count, created_by)
values ('00000000-0000-4000-8000-00000000a0f1', gen_random_uuid(), 5, 1, '00000000-0000-4000-8000-0000000000c2');
select throws_ok($$update public.price_bulk_changes set status = 'reverted' where id = '00000000-0000-4000-8000-00000000a0f1'$$, '23514', null, 'el paso a deshecho exige los datos de la reversión (CHECK)');
select throws_ok(
  $$insert into public.price_history (product_id, old_sale_price, new_sale_price, old_cost_price, new_cost_price, source, bulk_change_id)
    values (pg_temp.pid('P1'), 1, 2, 1, 1, 'bulk_increase', null)$$,
  '23514', null, 'un cambio masivo sin aumento asociado se rechaza (CHECK)'
);
select throws_ok(
  $$insert into public.price_history (product_id, old_sale_price, new_sale_price, old_cost_price, new_cost_price, source, bulk_change_id)
    values (pg_temp.pid('P1'), 1, 2, 1, 1, 'manual', pg_temp.bid('A1'))$$,
  '23514', null, 'un cambio manual con aumento asociado se rechaza (CHECK)'
);
select throws_ok($$insert into public.price_bulk_changes (idempotency_key, percent, products_count) values (gen_random_uuid(), 0, 1)$$, '23514', null, 'porcentaje 0 se rechaza también en la tabla');
select throws_ok($$insert into public.price_bulk_changes (idempotency_key, percent, products_count) values (gen_random_uuid(), 60, 1)$$, '23514', null, 'más de 50 % se rechaza también en la tabla');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.price_history) > 0, 'el encargado lee price_history');
select ok((select count(*) from public.price_bulk_changes) > 0, 'el encargado lee price_bulk_changes');
select throws_ok($$insert into public.price_history (product_id, old_sale_price, new_sale_price, old_cost_price, new_cost_price, source) values (pg_temp.pid('P1'), 1, 2, 1, 1, 'manual')$$, '42501', null, 'el encargado no escribe price_history directo');
select throws_ok($$update public.price_bulk_changes set notes = 'x'$$, '42501', null, 'el encargado no edita price_bulk_changes directo');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c5", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.price_history) > 0, 'el programador lee price_history');
reset role;

-- Conciliación del precio final.
select is(
  (select count(*)::int from public.products p where p.id in (select id from t_p)
    and p.sale_price_with_vat <> round(p.sale_price * (1 + p.vat_rate / 100), 2)),
  0, 'sale_price_with_vat sigue siendo round(sale_price * (1 + IVA), 2) en todos los productos tocados'
);

select * from finish();
rollback;
