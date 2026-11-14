-- Paso D: productos.
-- Contrato v0.3.1 §5.5, §9 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura y nombres del contrato
-- ---------------------------------------------------------------------------
select has_table('public', 'products', 'existe products');
select hasnt_column('public', 'products', 'stock', 'products no tiene columna de stock');
select hasnt_column('public', 'products', 'stock_quantity', 'products no tiene stock_quantity');
select index_is_unique('public', 'products', 'products_sku_key', 'products_sku_key es único');
select index_is_unique('public', 'products', 'products_barcode_key', 'products_barcode_key es único');
select col_type_is('public', 'products', 'cost_price', 'numeric(12,2)', 'cost_price es numeric(12,2)');
select col_type_is('public', 'products', 'sale_price', 'numeric(12,2)', 'sale_price es numeric(12,2)');
select col_type_is('public', 'products', 'min_stock', 'numeric(12,3)', 'min_stock es numeric(12,3)');
select col_type_is('public', 'products', 'vat_rate', 'numeric(4,2)', 'vat_rate es numeric(4,2)');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'todas las tablas de public tienen RLS activada'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios (las altas simulan lo que hará la RPC create_product)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000002a', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-00000000002c', 'ines.inactiva@zahuy.test');
-- v0.4.0: los productos los edita el encargado.
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000002a';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000002c';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Lácteos');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000000b1', 'Marca Ficticia');
insert into public.suppliers (id, name) values ('00000000-0000-4000-8000-0000000000d1', 'Distribuidora Ficticia SA');

insert into public.products (id, sku, name, category_id, brand_id, cost_price, sale_price) values
  ('00000000-0000-4000-8000-0000000000e1', 'LAC-001', 'Leche entera 1 l', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000b1', 800, 1200);

select results_eq(
  $$select sale_unit, vat_rate, boxes_quantity, min_stock, is_active, supplier_id is null, barcode is null
    from public.products where sku = 'LAC-001'$$,
  $$values ('unit'::public.sale_unit, 21.00::numeric(4,2), 0, 0::numeric(12,3), true, true, true)$$,
  'valores por defecto del contrato'
);

insert into public.products (id, sku, barcode, name, category_id, brand_id, supplier_id, sale_unit, cost_price, sale_price, vat_rate, creation_key)
values
  ('00000000-0000-4000-8000-0000000000e2', 'QUE-001', '7790000000017', 'Queso cremoso', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'kg', 5000, 4500, 10.5,
   '00000000-0000-4000-8000-0000000000f1');

select is(
  (select sale_price < cost_price from public.products where sku = 'QUE-001'),
  true,
  'se permite vender por debajo del costo'
);

-- ---------------------------------------------------------------------------
-- Restricciones
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.products (sku, name, category_id, brand_id, cost_price, sale_price)
    values ('lac-001', 'Otra leche', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, 1)$$,
  '23505', 'duplicate key value violates unique constraint "products_sku_key"',
  'SKU duplicado sin distinguir mayúsculas (abc vs ABC)'
);
select throws_ok(
  $$insert into public.products (sku, barcode, name, category_id, brand_id, cost_price, sale_price)
    values ('QUE-002', '7790000000017', 'Otro queso', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, 1)$$,
  '23505', 'duplicate key value violates unique constraint "products_barcode_key"',
  'código de barras duplicado'
);
select throws_ok(
  $$insert into public.products (sku, name, category_id, brand_id, cost_price, sale_price, creation_key)
    values ('QUE-003', 'Otro queso', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, 1,
            '00000000-0000-4000-8000-0000000000f1')$$,
  '23505', null, 'creation_key duplicada'
);

create function pg_temp.try_product(p_sets text) returns text language plpgsql as $$
begin
  execute format(
    'update public.products set %s where id = ''00000000-0000-4000-8000-0000000000e1''', p_sets);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

select is(pg_temp.try_product($$sku = ' LAC-009'$$), '23514', 'SKU con espacio al inicio');
select is(pg_temp.try_product($$sku = ''$$), '23514', 'SKU vacío');
select is(pg_temp.try_product($$sku = repeat('S', 41)$$), '23514', 'SKU de más de 40 caracteres');
select is(pg_temp.try_product($$sku = repeat('S', 40)$$), 'ok', 'SKU de 40 caracteres');
select is(pg_temp.try_product($$sku = 'LAC-001'$$), 'ok', 'restaurar SKU');
select is(pg_temp.try_product($$barcode = '1234567'$$), '23514', 'código de barras de 7 dígitos');
select is(pg_temp.try_product($$barcode = '77900000000A'$$), '23514', 'código de barras con letras');
select is(pg_temp.try_product($$barcode = '77900000'$$), 'ok', 'código de barras de 8 dígitos');
select is(pg_temp.try_product($$barcode = null$$), 'ok', 'código de barras nulo');
select is(pg_temp.try_product($$name = '   '$$), '23514', 'nombre en blanco');
select is(pg_temp.try_product($$name = repeat('n', 151)$$), '23514', 'nombre de más de 150 caracteres');
select is(pg_temp.try_product($$vat_rate = 27$$), '23514', 'IVA 27% no admitido');
select is(pg_temp.try_product($$vat_rate = 0$$), '23514', 'IVA 0% no admitido');
select is(pg_temp.try_product($$vat_rate = 10.5$$), 'ok', 'IVA 10,5%');
select is(pg_temp.try_product($$vat_rate = 21$$), 'ok', 'IVA 21%');
select is(pg_temp.try_product($$cost_price = -0.01$$), '23514', 'costo negativo');
select is(pg_temp.try_product($$sale_price = -1$$), '23514', 'precio negativo');
select is(pg_temp.try_product($$cost_price = 0, sale_price = 0$$), 'ok', 'costo y precio en cero');
select is(pg_temp.try_product($$sale_price = 99999999999.99$$), '22003', 'importe fuera de numeric(12,2)');
select is(pg_temp.try_product($$boxes_quantity = -1$$), '23514', 'cajas negativas');
select is(pg_temp.try_product($$min_stock = -0.001$$), '23514', 'stock mínimo negativo');
select is(pg_temp.try_product($$min_stock = 2.5$$), 'ok', 'stock mínimo con decimales');
select is(pg_temp.try_product($$image_path = 'https://example.test/foto.jpg'$$), '23514', 'image_path no puede ser una URL');
select is(pg_temp.try_product($$image_path = 'products/leche.jpg'$$), 'ok', 'image_path como ruta del bucket');
select is(pg_temp.try_product($$category_id = '00000000-0000-4000-8000-00000000dead'$$), '23503', 'categoría inexistente');
select is(pg_temp.try_product($$brand_id = null$$), '23502', 'marca obligatoria');
select is(pg_temp.try_product($$category_id = null$$), '23502', 'categoría obligatoria');
select is(pg_temp.try_product($$supplier_id = '00000000-0000-4000-8000-0000000000d1'$$), 'ok', 'asignar proveedor');
select is(pg_temp.try_product($$supplier_id = null$$), 'ok', 'proveedor opcional');

select throws_ok(
  $$delete from public.categories where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23503', null, 'una categoría con productos no se puede borrar'
);
select throws_ok(
  $$delete from public.brands where id = '00000000-0000-4000-8000-0000000000b1'$$,
  '23503', null, 'una marca con productos no se puede borrar'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.products$$, '42501', null, 'anon no lee products');
reset role;

-- ---------------------------------------------------------------------------
-- Empleada activa
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000002a", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from public.products where sku in ('LAC-001', 'QUE-001')),
  2,
  'usuario activo lee los productos'
);

select throws_ok(
  $$insert into public.products (sku, name, category_id, brand_id, cost_price, sale_price)
    values ('DIR-001', 'Alta directa', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 1, 1)$$,
  '42501', null, 'el INSERT directo está revocado (solo create_product)'
);
select lives_ok(
  $$update public.products set sale_price = 1350.50, boxes_quantity = 4, is_active = false where sku = 'LAC-001'$$,
  'edita precio, cajas y estado'
);
select throws_ok(
  $$update public.products set sku = 'que-001' where sku = 'LAC-001'$$,
  '23505', 'duplicate key value violates unique constraint "products_sku_key"',
  'editar el SKU a uno existente'
);
select throws_ok(
  $$update public.products set creation_key = gen_random_uuid() where sku = 'LAC-001'$$,
  '42501', null, 'el cliente no puede escribir creation_key'
);
select throws_ok(
  $$update public.products set id = gen_random_uuid() where sku = 'LAC-001'$$,
  '42501', null, 'el cliente no puede cambiar el id'
);
select throws_ok(
  $$update public.products set created_by = null where sku = 'LAC-001'$$,
  '42501', null, 'el cliente no puede escribir created_by'
);
select throws_ok($$delete from public.products where sku = 'LAC-001'$$, '42501', null, 'no se borra un producto');
reset role;

select results_eq(
  $$select sale_price, boxes_quantity, is_active, updated_by from public.products where sku = 'LAC-001'$$,
  $$values (1350.50::numeric(12,2), 4, false, '00000000-0000-4000-8000-00000000002a'::uuid)$$,
  'la edición quedó guardada con su autor'
);

-- ---------------------------------------------------------------------------
-- Usuario inactivo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000002c", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.products), 0, 'inactivo no lee products');
select lives_ok(
  $$update public.products set sale_price = 1 where true$$, 'inactivo: el UPDATE no da error porque no ve filas'
);
reset role;

select is(
  (select count(*)::int from public.products where sale_price = 1),
  0,
  'el inactivo no modificó ningún precio'
);

select * from finish();
rollback;
