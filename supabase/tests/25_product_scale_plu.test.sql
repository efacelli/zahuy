-- PLU de balanza en productos (contrato v0.11.0, §21). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- Preexistentes: un producto cargado ANTES de la columna no tiene PLU (la migración no inventa datos).
select is(
  (select count(*)::int from public.products where scale_plu is not null), 0,
  'ningún producto tiene PLU por defecto'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) like '%p_scale_plu text'
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_product'),
  true, 'create_product tiene p_scale_plu'
);
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_product'),
  1, 'create_product tiene una sola sobrecarga'
);
select is(
  (select column_name::text from information_schema.columns where table_schema = 'public' and table_name = 'v_product_list'
    order by ordinal_position desc limit 1),
  'scale_plu', 'v_product_list termina con scale_plu'
);
select is(
  (select column_name::text from information_schema.columns where table_schema = 'public' and table_name = 'v_product_list'
    and column_name = 'search_name'), 'search_name', 'las columnas anteriores siguen'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'enzo.encargado.plu@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'eva.empleada.plu@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000e3', 'dora.duena.plu@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000e4', 'paco.programador.plu@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000e1';
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000e3';
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-0000000000e4';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000e0c1', 'Categoría PLU');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000e0b1', 'Marca PLU');

create temporary table t_p (code text primary key, id uuid) on commit drop;
grant all on t_p to authenticated;
create function pg_temp.pid(p text) returns uuid language sql as $$ select id from t_p where code = p $$;
grant execute on function pg_temp.pid(text) to authenticated;
create function pg_temp.mk(p_name text, p_unit public.sale_unit, p_plu text default null) returns uuid language sql as $$
  select (public.create_product(gen_random_uuid(), p_name, '00000000-0000-4000-8000-00000000e0c1', '00000000-0000-4000-8000-00000000e0b1',
    p_unit, 100, 1000, 21, p_scale_plu => p_plu)).id $$;
grant execute on function pg_temp.mk(text, public.sale_unit, text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}', true);
set local role authenticated;

-- Alta con y sin PLU (con ceros a la izquierda).
insert into t_p select 'A', pg_temp.mk('PLU A jamón', 'kg', '00005');
insert into t_p select 'B', pg_temp.mk('PLU B queso', 'kg');
insert into t_p select 'U', pg_temp.mk('PLU U fideos', 'unit');
select is((select scale_plu from public.products where id = pg_temp.pid('A')), '00005', 'PLU válido guardado con ceros');
select is((select scale_plu from public.products where id = pg_temp.pid('B')), null, 'create_product sin p_scale_plu: PLU nulo');
select is((select scale_plu from public.v_product_list where id = pg_temp.pid('A')), '00005', 'v_product_list expone el PLU');
select is(
  (select count(*)::int from public.v_product_list where id = pg_temp.pid('B') and scale_plu is null), 1, 'producto sin PLU en la lista'
);

-- Formato.
select throws_ok($$select pg_temp.mk('PLU x1', 'kg', '5')$$, '23514', null, '''5'' rechazado');
select throws_ok($$select pg_temp.mk('PLU x2', 'kg', '000005')$$, '23514', null, '''000005'' rechazado');
select throws_ok($$select pg_temp.mk('PLU x3', 'kg', '0000a')$$, '23514', null, '''0000a'' rechazado');
select throws_ok($$select pg_temp.mk('PLU x4', 'kg', '00000')$$, '23514', null, '''00000'' rechazado');
insert into t_p select 'X', pg_temp.mk('PLU x5', 'kg', ' 00006 ');
select is((select scale_plu from public.products where id = pg_temp.pid('X')), '00006', 'los espacios de los bordes se recortan');

-- Solo productos por kilo.
select throws_ok($$select pg_temp.mk('PLU unidad', 'unit', '00007')$$, '23514', null, 'PLU en un producto por unidad rechazado');
select throws_ok($$select pg_temp.mk('PLU litro', 'l', '00008')$$, '23514', null, 'PLU en un producto por litro rechazado');
select throws_ok(
  $$update public.products set sale_unit = 'unit' where id = pg_temp.pid('A')$$, '23514', null,
  'cambiar a otra unidad un producto con PLU rechazado'
);
select lives_ok(
  $$update public.products set scale_plu = null where id = pg_temp.pid('A')$$, 'se le quita el PLU...'
);
select lives_ok(
  $$update public.products set sale_unit = 'unit' where id = pg_temp.pid('A')$$, '...y recién entonces cambia de unidad'
);
select lives_ok($$update public.products set sale_unit = 'kg', scale_plu = '00005' where id = pg_temp.pid('A')$$, 'vuelve a kg con su PLU');

-- Único.
select throws_ok($$select pg_temp.mk('PLU repetido', 'kg', '00005')$$, '23505', null, 'PLU repetido en el alta -> 23505');
select throws_ok(
  $$update public.products set scale_plu = '00005' where id = pg_temp.pid('B')$$, '23505', null, 'PLU repetido al editar -> 23505'
);
select throws_matching(
  $$update public.products set scale_plu = '00005' where id = pg_temp.pid('B')$$, 'products_scale_plu_key', 'el error nombra el índice products_scale_plu_key'
);
select lives_ok($$update public.products set scale_plu = '00009' where id = pg_temp.pid('B')$$, 'el encargado edita el PLU');

-- Inactivo conserva el PLU y sigue reservándolo.
update public.products set is_active = false where id = pg_temp.pid('A');
select is((select scale_plu from public.products where id = pg_temp.pid('A')), '00005', 'un producto inactivo conserva su PLU');
select throws_ok($$select pg_temp.mk('PLU reusa', 'kg', '00005')$$, '23505', null, 'el PLU de un inactivo sigue reservado');
update public.products set scale_plu = null where id = pg_temp.pid('A');
select lives_ok($$select pg_temp.mk('PLU reusa', 'kg', '00005')$$, 'borrándoselo al inactivo, el PLU se puede reusar');
reset role;

-- Búsqueda por la vista: el PLU se encuentra por igualdad (la caja usa products directo).
select is(
  (select count(*)::int from public.products where scale_plu = '00005' and is_active and sale_unit = 'kg'), 1,
  'la caja encuentra un único producto activo por kilo con ese PLU'
);

-- El empleado no puede cambiarlo; dueño y programador sí.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.products set scale_plu = '00020' where id = pg_temp.pid('B')$$, 'P0001', 'NOT_AUTHORIZED', 'el empleado no cambia el PLU'
);
select throws_ok(
  $$update public.products set scale_plu = null where id = pg_temp.pid('B')$$, 'P0001', 'NOT_AUTHORIZED', 'ni se lo quita'
);
select lives_ok(
  $$update public.products set boxes_quantity = 3 where id = pg_temp.pid('B')$$, 'el empleado sigue pudiendo actualizar las cajas'
);
select is((select scale_plu from public.v_product_list where id = pg_temp.pid('B')), '00009', 'el empleado lee el PLU');
select throws_ok($$select pg_temp.mk('PLU empleado', 'kg', '00021')$$, 'P0001', 'NOT_AUTHORIZED', 'el empleado no crea productos');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000e3", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$update public.products set scale_plu = '00030' where id = pg_temp.pid('B')$$, 'el dueño cambia el PLU');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000e4", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$update public.products set scale_plu = '00031' where id = pg_temp.pid('B')$$, 'el programador cambia el PLU');
reset role;
select is((select scale_plu from public.products where id = pg_temp.pid('B')), '00031', 'el cambio quedó');

-- Auditoría.
select ok(
  (select count(*) from public.audit_log where table_name = 'products' and action = 'update' and new_data ->> 'scale_plu' = '00031') >= 1,
  'el cambio del PLU quedó en audit_log'
);

-- anon.
set local role anon;
select throws_ok($$select scale_plu from public.v_product_list$$, '42501', null, 'anon no lee la lista');
reset role;

select * from finish();
rollback;
