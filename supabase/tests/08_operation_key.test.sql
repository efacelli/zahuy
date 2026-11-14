-- v0.4 paso D: stock_movements.operation_key.
-- Contrato v0.4.x §5.7. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_column('public', 'stock_movements', 'operation_key', 'existe operation_key');
select col_type_is('public', 'stock_movements', 'operation_key', 'uuid', 'operation_key es uuid');
select col_is_null('public', 'stock_movements', 'operation_key', 'operation_key admite nulo');
select has_index('public', 'stock_movements', 'stock_movements_operation_key_idx', 'existe stock_movements_operation_key_idx');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000008b', 'enzo.encargado@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000008b';
insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000008c1', 'Categoría paso D');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000008b1', 'Marca paso D');
insert into public.products (id, name, category_id, brand_id, cost_price, sale_price) values
  ('00000000-0000-4000-8000-0000000008e1', 'Producto paso D', '00000000-0000-4000-8000-0000000008c1',
   '00000000-0000-4000-8000-0000000008b1', 1, 2);

-- Dos lotes con su ingreso (sin operation_key) y una salida repartida entre
-- ambos, como la hará register_product_movement.
set constraints all deferred;
insert into public.product_batches (id, product_id, expires_on, quantity_initial, quantity_available) values
  ('00000000-0000-4000-8000-0000000008f1', '00000000-0000-4000-8000-0000000008e1', date '2027-01-31', 4, 0),
  ('00000000-0000-4000-8000-0000000008f2', '00000000-0000-4000-8000-0000000008e1', date '2027-06-30', 20, 14);
insert into public.stock_movements
  (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
values
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000008e1', '00000000-0000-4000-8000-0000000008f1', 'entry', 4, 4,
   '00000000-0000-4000-8000-00000000008b'),
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000008e1', '00000000-0000-4000-8000-0000000008f2', 'entry', 20, 20,
   '00000000-0000-4000-8000-00000000008b');
insert into public.stock_movements
  (idempotency_key, operation_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
values
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000008aa', '00000000-0000-4000-8000-0000000008e1',
   '00000000-0000-4000-8000-0000000008f1', 'exit', 4, 0, '00000000-0000-4000-8000-00000000008b'),
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000008aa', '00000000-0000-4000-8000-0000000008e1',
   '00000000-0000-4000-8000-0000000008f2', 'exit', 6, 14, '00000000-0000-4000-8000-00000000008b');
set constraints all immediate;

select is(
  (select count(*)::int from public.stock_movements
    where product_id = '00000000-0000-4000-8000-0000000008e1' and operation_key is null),
  2, 'los ingresos quedan sin operation_key'
);
select results_eq(
  $$select count(*)::int, sum(quantity) from public.stock_movements
    where operation_key = '00000000-0000-4000-8000-0000000008aa'$$,
  $$values (2, 10.000::numeric)$$,
  'varios movimientos comparten una operation_key (no es única)'
);

-- Lectura con RLS, como el resto de las columnas.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000008b", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.stock_movements where operation_key = '00000000-0000-4000-8000-0000000008aa'),
  2, 'un usuario activo lee operation_key'
);
select throws_ok(
  $$update public.stock_movements set operation_key = gen_random_uuid()$$,
  '42501', null, 'operation_key no se escribe desde la app'
);
reset role;

select * from finish();
rollback;
