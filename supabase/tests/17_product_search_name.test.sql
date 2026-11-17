-- v0.5.1: búsqueda sin tildes ni mayúsculas (contrato §5.5 y §7.3). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select col_type_is('public', 'products', 'search_name', 'text', 'products.search_name existe');
select is(
  (select attgenerated from pg_attribute where attrelid = 'public.products'::regclass and attname = 'search_name'),
  's', 'search_name es una columna generada'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'v_product_list' and ordinal_position >= 31),
  array['has_box_mismatch', 'legacy_code', 'search_name', 'scale_plu'],
  'v_product_list suma search_name y luego scale_plu al final, sin mover columnas'
);
select ok(
  has_table_privilege('authenticated', 'public.v_product_list', 'select')
  and not has_table_privilege('anon', 'public.v_product_list', 'select')
  and (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_product_list'::regclass),
  'v_product_list conserva permisos y security_invoker'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000017a1', 'ana.encargada17@zahuy.test'),
  ('00000000-0000-4000-8000-0000000017a2', 'beto.empleado17@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000017a1';
insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000017c1', 'Categoría 17');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000017b1', 'Marca 17');
insert into public.products (id, name, category_id, brand_id, cost_price, sale_price) values
  ('00000000-0000-4000-8000-0000000017d1', 'Dulce de Leche LA SERENÍSIMA Clásico', '00000000-0000-4000-8000-0000000017c1',
   '00000000-0000-4000-8000-0000000017b1', 1, 2);

select is((select search_name from public.products where id = '00000000-0000-4000-8000-0000000017d1'),
  'dulce de leche la serenisima clasico', 'search_name: sin tildes y en minúscula');
select is(
  (select count(*)::int from public.v_product_list where search_name ilike '%serenisima clasico%'),
  1, 'se encuentra escribiendo sin tildes'
);

-- Se recalcula al cambiar el nombre.
update public.products set name = 'Ñoquis de Papa' where id = '00000000-0000-4000-8000-0000000017d1';
select is((select search_name from public.products where id = '00000000-0000-4000-8000-0000000017d1'),
  'noquis de papa', 'search_name se recalcula al cambiar el nombre');

-- El empleado sigue pudiendo actualizar solo las cajas.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000017a2", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$update public.products set boxes_quantity = 3 where id = '00000000-0000-4000-8000-0000000017d1'$$,
  'el empleado actualiza las cajas (search_name no lo frena)'
);
select throws_ok(
  $$update public.products set name = 'Otro' where id = '00000000-0000-4000-8000-0000000017d1'$$,
  'P0001', 'NOT_AUTHORIZED', 'el empleado sigue sin poder cambiar el nombre'
);
reset role;

select throws_ok(
  $$update public.products set search_name = 'x' where id = '00000000-0000-4000-8000-0000000017d1'$$,
  '428C9', null, 'nadie escribe search_name a mano'
);

select * from finish();
rollback;
