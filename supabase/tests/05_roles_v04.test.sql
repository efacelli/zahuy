-- v0.4 paso A: permisos por rol (empleado, encargado, dueño, inactivo).
-- Contrato v0.4.x §4.1, §9 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Enums de la transición (§8.8)
-- ---------------------------------------------------------------------------
select enum_has_labels(
  'public', 'movement_type',
  array['entry', 'exit', 'adjustment_in', 'adjustment_out', 'shrinkage', 'damage', 'customer_return',
        'supplier_return', 'internal_use', 'sale'],
  'movement_type incluye internal_use (y sale, v0.6)'
);
select enum_has_labels(
  'public', 'expiry_status',
  array['depleted', 'no_expiry', 'expired', 'expires_urgent', 'expires_soon', 'expires_upcoming', 'ok'],
  'expiry_status usa los nombres sin número de días'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios: un usuario de cada tipo
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000005a', 'dora.duena@zahuy.test'),
  ('00000000-0000-4000-8000-00000000005b', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-00000000005c', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-00000000005d', 'ivan.inactivo@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000005a';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000005b';
-- Un encargado desactivado no conserva permisos.
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-00000000005d';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000005c1', 'Categoría roles');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000005b1', 'Marca roles');
insert into public.suppliers (id, name) values ('00000000-0000-4000-8000-0000000005d1', 'Proveedor roles');
insert into public.products (id, sku, name, category_id, brand_id, cost_price, sale_price, min_stock) values
  ('00000000-0000-4000-8000-0000000005e1', 'ROL-001', 'Producto roles', '00000000-0000-4000-8000-0000000005c1',
   '00000000-0000-4000-8000-0000000005b1', 100, 200, 5);

set constraints all deferred;
insert into public.product_batches (id, product_id, expires_on, quantity_initial, quantity_available)
values ('00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-0000000005e1', date '2027-12-31', 10, 10);
insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
values (gen_random_uuid(), '00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000005f1', 'entry', 10, 10,
        '00000000-0000-4000-8000-00000000005b');
set constraints all immediate;

-- Motivo obligatorio también para internal_use (CHECK existente).
select throws_ok(
  $$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000005f1', 'internal_use', 1, 9,
            '00000000-0000-4000-8000-00000000005b')$$,
  '23514', null, 'internal_use sin motivo se rechaza'
);

-- ---------------------------------------------------------------------------
-- Empleada (staff)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000005c", "role": "authenticated"}', true);
set local role authenticated;

select is((select private.is_manager_or_admin()), false, 'empleada: is_manager_or_admin es false');
select is((select private.can_manage_inventory()), false, 'empleada: can_manage_inventory es false');

-- Lee todo, incluidos costos.
select is(
  (select cost_price from public.products where id = '00000000-0000-4000-8000-0000000005e1'),
  100.00::numeric(12,2), 'empleada lee productos con su costo'
);
select is((select count(*)::int from public.categories where id = '00000000-0000-4000-8000-0000000005c1'), 1, 'empleada lee categorías');
select is((select count(*)::int from public.suppliers where id = '00000000-0000-4000-8000-0000000005d1'), 1, 'empleada lee proveedores');
select is((select count(*)::int from public.product_batches where id = '00000000-0000-4000-8000-0000000005f1'), 1, 'empleada lee lotes');
select is((select count(*)::int from public.stock_movements where batch_id = '00000000-0000-4000-8000-0000000005f1'), 1, 'empleada lee movimientos');

-- No escribe catálogos.
select throws_ok($$insert into public.categories (name) values ('De empleada')$$, '42501', null, 'empleada no crea categorías');
select throws_ok($$insert into public.brands (name) values ('De empleada')$$, '42501', null, 'empleada no crea marcas');
select throws_ok($$insert into public.suppliers (name) values ('De empleada')$$, '42501', null, 'empleada no crea proveedores');
select lives_ok(
  $$update public.categories set name = 'Cambiada por empleada' where id = '00000000-0000-4000-8000-0000000005c1'$$,
  'empleada: editar una categoría no da error (la RLS no le deja filas editables)'
);
select lives_ok(
  $$update public.brands set is_active = false where id = '00000000-0000-4000-8000-0000000005b1'$$,
  'empleada: desactivar una marca no da error'
);
select lives_ok(
  $$update public.suppliers set name = 'Cambiado por empleada' where id = '00000000-0000-4000-8000-0000000005d1'$$,
  'empleada: editar un proveedor no da error'
);

-- Productos: solo el conteo de cajas.
select lives_ok(
  $$update public.products set boxes_quantity = 7 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'empleada actualiza el conteo de cajas'
);
select throws_ok(
  $$update public.products set sale_price = 1 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no cambia precios'
);
select throws_ok(
  $$update public.products set cost_price = 1 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no cambia costos'
);
select throws_ok(
  $$update public.products set min_stock = 0 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no cambia el stock mínimo'
);
select throws_ok(
  $$update public.products set name = 'Renombrado' where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no renombra productos'
);
select throws_ok(
  $$update public.products set is_active = false where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no desactiva productos'
);
select throws_ok(
  $$update public.products set boxes_quantity = 9, sale_price = 1 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'P0001', 'NOT_AUTHORIZED', 'empleada no cuela un precio junto con las cajas'
);
select lives_ok(
  $$update public.products set boxes_quantity = 8, sale_price = 200, name = 'Producto roles'
    where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'empleada: reenviar los mismos valores junto con las cajas se acepta'
);

-- Lotes: solo lectura.
select lives_ok(
  $$update public.product_batches set notes = 'Nota de empleada' where id = '00000000-0000-4000-8000-0000000005f1'$$,
  'empleada: editar un lote no da error (sin filas editables)'
);
select is((select count(*)::int from public.audit_log), 0, 'empleada no lee la auditoría');
reset role;

select results_eq(
  $$select boxes_quantity, sale_price, cost_price, min_stock, name, is_active, updated_by
    from public.products where id = '00000000-0000-4000-8000-0000000005e1'$$,
  $$values (8, 200.00::numeric(12,2), 100.00::numeric(12,2), 5.000::numeric(12,3), 'Producto roles', true,
            '00000000-0000-4000-8000-00000000005c'::uuid)$$,
  'de la empleada solo quedó el conteo de cajas, con su autoría'
);
select is((select name from public.categories where id = '00000000-0000-4000-8000-0000000005c1'), 'Categoría roles', 'la categoría no cambió');
select is((select is_active from public.brands where id = '00000000-0000-4000-8000-0000000005b1'), true, 'la marca no cambió');
select is((select name from public.suppliers where id = '00000000-0000-4000-8000-0000000005d1'), 'Proveedor roles', 'el proveedor no cambió');
select is((select notes from public.product_batches where id = '00000000-0000-4000-8000-0000000005f1'), null, 'el lote no cambió');

-- ---------------------------------------------------------------------------
-- Encargado (manager)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000005b", "role": "authenticated"}', true);
set local role authenticated;

select is((select private.is_manager_or_admin()), true, 'encargado: is_manager_or_admin es true');
select is((select private.is_admin()), false, 'encargado: is_admin es false');

select lives_ok($$insert into public.categories (name) values ('Categoría del encargado')$$, 'encargado crea categorías');
select lives_ok($$insert into public.brands (name) values ('Marca del encargado')$$, 'encargado crea marcas');
select lives_ok($$insert into public.suppliers (name) values ('Proveedor del encargado')$$, 'encargado crea proveedores');
select lives_ok(
  $$update public.suppliers set phone = '011 5555-0101' where id = '00000000-0000-4000-8000-0000000005d1'$$,
  'encargado edita proveedores'
);
select lives_ok(
  $$update public.products set sale_price = 250, min_stock = 3, boxes_quantity = 2
    where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'encargado cambia precio, stock mínimo y cajas'
);
select lives_ok(
  $$update public.product_batches set notes = 'Revisado por el encargado' where id = '00000000-0000-4000-8000-0000000005f1'$$,
  'encargado edita los datos de un lote'
);
select throws_ok($$delete from public.categories where name = 'Categoría del encargado'$$, '42501', null, 'encargado no borra catálogos');
select lives_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000005b'$$,
  'encargado: intentar hacerse dueño no da error (sin filas editables)'
);
select is((select count(*)::int from public.audit_log), 0, 'encargado no lee la auditoría');
reset role;

select results_eq(
  $$select sale_price, min_stock, boxes_quantity from public.products where id = '00000000-0000-4000-8000-0000000005e1'$$,
  $$values (250.00::numeric(12,2), 3.000::numeric(12,3), 2)$$,
  'los cambios del encargado quedaron guardados'
);
select is(
  (select notes from public.product_batches where id = '00000000-0000-4000-8000-0000000005f1'),
  'Revisado por el encargado', 'la nota del lote quedó guardada'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-00000000005b'),
  'manager'::public.app_role, 'el encargado no pudo hacerse dueño'
);

-- ---------------------------------------------------------------------------
-- Dueña (admin): todo lo del encargado, más usuarios y auditoría
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000005a", "role": "authenticated"}', true);
set local role authenticated;

select is((select private.is_manager_or_admin()), true, 'dueña: is_manager_or_admin es true');
select lives_ok($$insert into public.categories (name) values ('Categoría de la dueña')$$, 'dueña crea categorías');
select lives_ok(
  $$update public.products set cost_price = 120 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'dueña cambia costos'
);
select lives_ok(
  $$update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000005c'$$,
  'dueña asciende a una empleada a encargada'
);
select cmp_ok((select count(*)::int from public.audit_log), '>', 0, 'dueña lee la auditoría');
select results_eq(
  $$select changed_by, (old_data ->> 'boxes_quantity')::int, (new_data ->> 'boxes_quantity')::int
    from public.audit_log
    where table_name = 'products' and record_id = '00000000-0000-4000-8000-0000000005e1'
      and changed_by = '00000000-0000-4000-8000-00000000005c' and action = 'update'
    order by id$$,
  $$values ('00000000-0000-4000-8000-00000000005c'::uuid, 0, 7),
           ('00000000-0000-4000-8000-00000000005c'::uuid, 7, 8)$$,
  'los conteos de cajas de la empleada quedaron auditados'
);
reset role;

-- La empleada ascendida ahora sí puede.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000005c", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$update public.products set sale_price = 260 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'tras el ascenso, cambia precios'
);
reset role;

-- ---------------------------------------------------------------------------
-- Encargado inactivo: nada
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000005d", "role": "authenticated"}', true);
set local role authenticated;

select is((select private.is_manager_or_admin()), false, 'encargado inactivo: is_manager_or_admin es false');
select is((select count(*)::int from public.products), 0, 'inactivo no lee productos');
select is((select count(*)::int from public.categories), 0, 'inactivo no lee categorías');
select throws_ok($$insert into public.categories (name) values ('De inactivo')$$, '42501', null, 'inactivo no crea categorías');
select lives_ok(
  $$update public.products set boxes_quantity = 99 where id = '00000000-0000-4000-8000-0000000005e1'$$,
  'inactivo: actualizar cajas no da error (no ve filas)'
);
reset role;

select is(
  (select boxes_quantity from public.products where id = '00000000-0000-4000-8000-0000000005e1'),
  2, 'el inactivo no cambió las cajas'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select private.is_manager_or_admin()$$, '42501', null, 'anon no ejecuta is_manager_or_admin');
select throws_ok($$insert into public.categories (name) values ('De anon')$$, '42501', null, 'anon no crea categorías');
reset role;

select * from finish();
rollback;
