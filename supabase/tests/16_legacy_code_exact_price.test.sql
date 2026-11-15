-- v0.5.0: código del sistema anterior (P-25) y precio final exacto (P-24).
-- Contrato §5.5, §7.3 y §8.4. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select col_type_is('public', 'products', 'sale_price', 'numeric(12,4)', 'sale_price tiene 4 decimales');
select col_type_is('public', 'products', 'sale_price_with_vat', 'numeric(12,2)', 'el precio final sigue en centavos');
select col_type_is('public', 'products', 'legacy_code', 'text', 'products.legacy_code existe');
select col_is_null('public', 'products', 'legacy_code', 'legacy_code es nulable');
select has_index('public', 'products', 'products_legacy_code_key', 'índice único products_legacy_code_key');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'v_product_list' and ordinal_position between 30 and 32),
  array['loose_units', 'has_box_mismatch', 'legacy_code'],
  'v_product_list suma legacy_code al final, sin mover las demás columnas'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'v_inventory_summary'),
  9, 'v_inventory_summary conserva sus 9 columnas'
);
select ok(
  has_table_privilege('authenticated', 'public.v_product_list', 'select')
  and has_table_privilege('authenticated', 'public.v_inventory_summary', 'select')
  and not has_table_privilege('anon', 'public.v_product_list', 'select')
  and not has_table_privilege('anon', 'public.v_inventory_summary', 'select'),
  'las vistas recreadas conservan sus permisos'
);
select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_product_list'::regclass)
  and (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_inventory_summary'::regclass),
  'las vistas recreadas siguen con security_invoker'
);
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_product'),
  1, 'hay una sola create_product (la firma vieja se borró)'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000016a1', 'lia.encargada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000016a2', 'max.empleado@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000016a1';
insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000016c1', 'Categoría P25');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000016b1', 'Marca P25');

create temporary table t_p (k text primary key, id uuid) on commit drop;
grant all on t_p to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000016a1", "role": "authenticated"}', true);
set local role authenticated;

-- Precio final $1.200 con IVA 21 %: sin IVA 991,7355 (4 decimales).
insert into t_p select 'a', (public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-0000000016e1', p_name => 'Galletitas P25',
  p_category_id => '00000000-0000-4000-8000-0000000016c1', p_brand_id => '00000000-0000-4000-8000-0000000016b1',
  p_sale_unit => 'unit', p_cost_price => 712, p_sale_price => 991.7355, p_vat_rate => 21,
  p_legacy_code => ' T16-884325 ')).id;

select is((select sale_price from public.products where id = (select id from t_p where k = 'a')), 991.7355::numeric,
  'guarda los 4 decimales');
select is((select sale_price_with_vat from public.products where id = (select id from t_p where k = 'a')), 1200.00::numeric,
  'el precio final queda exacto: $1.200,00 (con 2 decimales daba $1.200,01)');
select is((select legacy_code from public.products where id = (select id from t_p where k = 'a')), 'T16-884325',
  'create_product guarda el código anterior sin espacios');
select is((select legacy_code from public.v_product_list where id = (select id from t_p where k = 'a')), 'T16-884325',
  'v_product_list expone legacy_code');

-- IVA 10,5 %: $550 final.
insert into t_p select 'b', (public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-0000000016e2', p_name => 'Leche P25',
  p_category_id => '00000000-0000-4000-8000-0000000016c1', p_brand_id => '00000000-0000-4000-8000-0000000016b1',
  p_sale_unit => 'unit', p_cost_price => 400, p_sale_price => round(550 / 1.105, 4), p_vat_rate => 10.5,
  p_legacy_code => 'T16-001')).id;
select is((select sale_price_with_vat from public.products where id = (select id from t_p where k = 'b')), 550.00::numeric,
  'con IVA 10,5 % también queda exacto');

-- Único sin distinguir mayúsculas.
select throws_ok(
  $$select public.create_product(
    p_idempotency_key => '00000000-0000-4000-8000-0000000016e3', p_name => 'Otro P25',
    p_category_id => '00000000-0000-4000-8000-0000000016c1', p_brand_id => '00000000-0000-4000-8000-0000000016b1',
    p_sale_unit => 'unit', p_cost_price => 1, p_sale_price => 2, p_vat_rate => 21, p_legacy_code => 'T16-001')$$,
  '23505', 'duplicate key value violates unique constraint "products_legacy_code_key"',
  'un código anterior repetido da 23505 sobre products_legacy_code_key'
);
-- Sin código anterior: varios productos pueden quedar en NULL.
select lives_ok(
  $$select public.create_product(
    p_idempotency_key => '00000000-0000-4000-8000-0000000016e4', p_name => 'Sin código P25',
    p_category_id => '00000000-0000-4000-8000-0000000016c1', p_brand_id => '00000000-0000-4000-8000-0000000016b1',
    p_sale_unit => 'unit', p_cost_price => 1, p_sale_price => 2, p_vat_rate => 21)$$,
  'el código anterior es opcional'
);
-- Reintento idempotente: no duplica ni falla por el código.
select is(
  (public.create_product(
    p_idempotency_key => '00000000-0000-4000-8000-0000000016e1', p_name => 'Galletitas P25',
    p_category_id => '00000000-0000-4000-8000-0000000016c1', p_brand_id => '00000000-0000-4000-8000-0000000016b1',
    p_sale_unit => 'unit', p_cost_price => 712, p_sale_price => 991.7355, p_vat_rate => 21,
    p_legacy_code => 'T16-884325')).id,
  (select id from t_p where k = 'a'), 'el reintento devuelve el mismo producto'
);

-- El encargado puede corregir el código anterior.
select lives_ok(
  format($$update public.products set legacy_code = 'T16-884326' where id = %L$$, (select id from t_p where k = 'a')),
  'el encargado edita legacy_code'
);
reset role;

-- El empleado no.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000016a2", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  format($$update public.products set legacy_code = 'X1' where id = %L$$, (select id from t_p where k = 'a')),
  'P0001', 'NOT_AUTHORIZED', 'el empleado no edita legacy_code'
);
reset role;

-- Formato.
select throws_ok(
  $$insert into public.products (name, category_id, brand_id, cost_price, sale_price, legacy_code)
    values ('Mal P25', '00000000-0000-4000-8000-0000000016c1', '00000000-0000-4000-8000-0000000016b1', 1, 1, ' 12 ')$$,
  '23514', null, 'legacy_code con espacios en los extremos se rechaza'
);

select * from finish();
rollback;
