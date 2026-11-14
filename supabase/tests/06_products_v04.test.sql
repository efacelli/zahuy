-- v0.4 paso B: SKU generado, unidades por caja y precio final con IVA.
-- Contrato v0.4.x §5.5 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_sequence('public', 'products_sku_seq', 'existe products_sku_seq');
select has_column('public', 'products', 'units_per_box', 'existe units_per_box');
select col_type_is('public', 'products', 'units_per_box', 'integer', 'units_per_box es integer');
select col_not_null('public', 'products', 'units_per_box', 'units_per_box no admite nulos');
select col_type_is('public', 'products', 'sale_price_with_vat', 'numeric(12,2)', 'sale_price_with_vat es numeric(12,2)');
select is(
  (select attgenerated::text from pg_attribute
    where attrelid = 'public.products'::regclass and attname = 'sale_price_with_vat'),
  's', 'sale_price_with_vat es una columna generada'
);

-- Formato del SKU.
select is(private.format_product_sku(1), '000001', 'SKU 1 → 000001');
select is(private.format_product_sku(42), '000042', 'SKU 42 → 000042');
select is(private.format_product_sku(999999), '999999', 'SKU 999999 → 999999');
select is(private.format_product_sku(1000000), '1000000', 'SKU 1000000 no se recorta');

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000006b', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-00000000006c', 'eva.empleada@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000006b';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000006c1', 'Categoría paso B');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000006b1', 'Marca paso B');

-- Altas sin SKU: lo asigna la base.
create temporary table t_sku (step int, sku text) on commit drop;

with ins as (
  insert into public.products (name, category_id, brand_id, cost_price, sale_price, vat_rate)
  values ('Producto B uno', '00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-0000000006b1', 700, 1000, 21)
  returning sku
)
insert into t_sku select 1, sku from ins;

select matches((select sku from t_sku where step = 1), '^[0-9]{6}$', 'el SKU generado tiene 6 dígitos');

with ins as (
  insert into public.products (name, category_id, brand_id, cost_price, sale_price, vat_rate)
  values ('Producto B dos', '00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-0000000006b1', 700, 1000, 10.5)
  returning sku
)
insert into t_sku select 2, sku from ins;

select is(
  (select sku::int from t_sku where step = 2),
  (select sku::int + 1 from t_sku where step = 1),
  'el siguiente SKU es el número siguiente'
);

-- Un SKU ya usado (cargado a mano) se saltea.
insert into public.products (sku, name, category_id, brand_id, cost_price, sale_price)
select private.format_product_sku(sku::int + 1), 'Producto B con SKU manual',
       '00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-0000000006b1', 1, 1
from t_sku where step = 2;

with ins as (
  insert into public.products (name, category_id, brand_id, cost_price, sale_price)
  values ('Producto B tres', '00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-0000000006b1', 1, 0.01)
  returning sku
)
insert into t_sku select 3, sku from ins;

select is(
  (select sku::int from t_sku where step = 3),
  (select sku::int + 2 from t_sku where step = 2),
  'la base saltea un SKU que ya existe'
);

-- ---------------------------------------------------------------------------
-- Precio final con IVA
-- ---------------------------------------------------------------------------
select is(
  (select sale_price_with_vat from public.products where name = 'Producto B uno'),
  1210.00::numeric(12,2), '1000 con IVA 21 → 1210,00'
);
select is(
  (select sale_price_with_vat from public.products where name = 'Producto B dos'),
  1105.00::numeric(12,2), '1000 con IVA 10,5 → 1105,00'
);
select is(
  (select sale_price_with_vat from public.products where name = 'Producto B tres'),
  0.01::numeric(12,2), '0,01 con IVA 21 → 0,01 (redondeo a centavos)'
);

update public.products set sale_price = 999.99, vat_rate = 10.5 where name = 'Producto B uno';
select is(
  (select sale_price_with_vat from public.products where name = 'Producto B uno'),
  1104.99::numeric(12,2), 'se recalcula al cambiar precio o IVA (999,99 × 1,105 = 1104,989 → 1104,99)'
);
select throws_ok(
  $$update public.products set sale_price_with_vat = 1 where name = 'Producto B uno'$$,
  '428C9', null, 'el precio final no se escribe: es una columna generada'
);

-- ---------------------------------------------------------------------------
-- Unidades por caja
-- ---------------------------------------------------------------------------
select is(
  (select units_per_box from public.products where name = 'Producto B uno'),
  12, 'units_per_box es 12 por defecto'
);
select throws_ok(
  $$update public.products set units_per_box = 0 where name = 'Producto B uno'$$,
  '23514', null, 'units_per_box debe ser mayor que cero'
);
select throws_ok(
  $$update public.products set units_per_box = null where name = 'Producto B uno'$$,
  '23502', null, 'units_per_box no admite nulo'
);

-- ---------------------------------------------------------------------------
-- Encargado
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000006b", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update public.products set units_per_box = 24 where name = 'Producto B uno'$$,
  'encargado cambia las unidades por caja'
);
select throws_ok(
  $$update public.products set sku = 'NUEVO-SKU' where name = 'Producto B uno'$$,
  '42501', null, 'el SKU no se edita desde la app, ni siquiera el encargado'
);
select throws_ok(
  $$update public.products set sale_price_with_vat = 1 where name = 'Producto B uno'$$,
  '428C9', null, 'el precio final no se escribe desde la app'
);
select is(
  (select sale_price_with_vat from public.products where name = 'Producto B uno'),
  1104.99::numeric(12,2), 'encargado lee el precio final'
);
reset role;

-- ---------------------------------------------------------------------------
-- Empleada
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000006c", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$update public.products set units_per_box = 6 where name = 'Producto B uno'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no cambia las unidades por caja'
);
select lives_ok(
  $$update public.products set boxes_quantity = 3 where name = 'Producto B uno'$$,
  'empleada sigue pudiendo contar cajas'
);
select throws_ok(
  $$select nextval('public.products_sku_seq')$$,
  '42501', null, 'la secuencia del SKU no es accesible desde la app'
);
reset role;

select results_eq(
  $$select units_per_box, boxes_quantity from public.products where name = 'Producto B uno'$$,
  $$values (24, 3)$$,
  'quedaron las unidades por caja del encargado y las cajas de la empleada'
);

-- La auditoría registra el cambio de unidades por caja con su autor.
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'products' and action = 'update'
      and changed_by = '00000000-0000-4000-8000-00000000006b'
      and (old_data ->> 'units_per_box')::int = 12 and (new_data ->> 'units_per_box')::int = 24),
  1, 'el cambio de unidades por caja quedó auditado'
);

select * from finish();
rollback;
