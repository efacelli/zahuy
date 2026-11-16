-- Datos del comercio para el ticket (contrato v0.9.x, §18). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- Estructura: tres columnas nulables, nulas por defecto.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_settings'
      and column_name in ('store_name', 'store_address', 'store_tax_id') and is_nullable = 'YES'),
  3, 'sales_settings tiene store_name, store_address y store_tax_id, todas nulables'
);

-- La migración no carga ningún dato del comercio (el repositorio es público).
select is(
  (select count(*)::int from public.sales_settings
    where store_name is not null or store_address is not null or store_tax_id is not null),
  0, 'por defecto no hay ningún dato del comercio cargado'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'dora.duena.com@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'enzo.encargado.com@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000b3', 'eva.empleada.com@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000b4', 'ivan.inactivo.com@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000b5', 'paco.programador.com@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000b1';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000b2';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000b4';
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-0000000000b5';

-- Permisos por columna: authenticated actualiza exactamente estas tres columnas nuevas.
select is(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'sales_settings'
      and c.column_name in ('store_name', 'store_address', 'store_tax_id')
      and has_column_privilege('authenticated', 'public.sales_settings', c.column_name, 'update')),
  3, 'authenticated puede actualizar las tres columnas (la RLS limita a quién)'
);
select is(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'sales_settings'
      and c.column_name in ('store_name', 'store_address', 'store_tax_id')
      and has_column_privilege('anon', 'public.sales_settings', c.column_name, 'select')),
  0, 'anon no lee las columnas'
);

-- El encargado las edita.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}', true);
set local role authenticated;
update public.sales_settings set store_name = 'Almacén de prueba', store_address = 'Calle Falsa 123', store_tax_id = '20000000001';
select results_eq(
  $$select store_name, store_address, store_tax_id from public.sales_settings$$,
  $$values ('Almacén de prueba'::text, 'Calle Falsa 123'::text, '20000000001'::text)$$,
  'el encargado carga nombre, dirección y CUIT'
);
update public.sales_settings set store_name = '  Nombre con espacios  ';
select is((select store_name from public.sales_settings), '  Nombre con espacios  ', 'el nombre se guarda tal cual (la UI lo recorta)');
update public.sales_settings set store_name = null, store_address = null, store_tax_id = null;
select results_eq(
  $$select store_name, store_address, store_tax_id from public.sales_settings$$,
  $$values (null::text, null::text, null::text)$$,
  'se pueden volver a dejar vacíos (nulos)'
);
reset role;

-- La empleada las lee pero su UPDATE no cambia nada.
update public.sales_settings set store_name = 'Para el ticket';
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000b3", "role": "authenticated"}', true);
set local role authenticated;
select is((select store_name from public.sales_settings), 'Para el ticket', 'la empleada lee los datos del comercio para imprimir el ticket');
update public.sales_settings set store_name = 'Hackeado';
reset role;
select is((select store_name from public.sales_settings), 'Para el ticket', 'el UPDATE de la empleada no cambia nada (la RLS filtra la fila)');

-- El dueño y el programador sí.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}', true);
set local role authenticated;
update public.sales_settings set store_address = 'Dirección del dueño';
reset role;
select is((select store_address from public.sales_settings), 'Dirección del dueño', 'el dueño edita la dirección');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000b5", "role": "authenticated"}', true);
set local role authenticated;
update public.sales_settings set store_address = 'Dirección del programador';
reset role;
select is((select store_address from public.sales_settings), 'Dirección del programador', 'el programador edita la dirección');

-- El inactivo no lee ni edita.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000b4", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.sales_settings), 0, 'un usuario inactivo no lee sales_settings');
update public.sales_settings set store_name = 'Inactivo';
reset role;
select is((select store_name from public.sales_settings), 'Para el ticket', 'ni edita');

-- anon.
set local role anon;
select throws_ok($$select store_name from public.sales_settings$$, '42501', null, 'anon no lee los datos del comercio');
reset role;

-- Restricciones.
select throws_ok($$update public.sales_settings set store_tax_id = '2000000000A'$$, '23514', null, 'CUIT con letras -> 23514');
select throws_ok($$update public.sales_settings set store_tax_id = '2000000001'$$, '23514', null, 'CUIT de 10 dígitos -> 23514');
select throws_ok($$update public.sales_settings set store_tax_id = '200000000011'$$, '23514', null, 'CUIT de 12 dígitos -> 23514');
select throws_ok($$update public.sales_settings set store_tax_id = '20-00000000-1'$$, '23514', null, 'CUIT con guiones -> 23514');
select lives_ok($$update public.sales_settings set store_tax_id = '30123456789'$$, 'CUIT de 11 dígitos -> válido');
select throws_ok($$update public.sales_settings set store_name = ''$$, '23514', null, 'nombre vacío -> 23514');
select throws_ok($$update public.sales_settings set store_name = '   '$$, '23514', null, 'nombre de solo espacios -> 23514');
select throws_ok($$update public.sales_settings set store_name = repeat('a', 81)$$, '23514', null, 'nombre de 81 caracteres -> 23514');
select lives_ok($$update public.sales_settings set store_name = repeat('a', 80)$$, 'nombre de 80 caracteres -> válido');
select throws_ok($$update public.sales_settings set store_address = ''$$, '23514', null, 'dirección vacía -> 23514');
select throws_ok($$update public.sales_settings set store_address = repeat('b', 121)$$, '23514', null, 'dirección de 121 caracteres -> 23514');
select lives_ok($$update public.sales_settings set store_address = repeat('b', 120)$$, 'dirección de 120 caracteres -> válida');

-- Auditoría: cada cambio queda en audit_log.
select ok(
  (select count(*) from public.audit_log
    where table_name = 'sales_settings' and action = 'update' and new_data ->> 'store_tax_id' = '30123456789') >= 1,
  'el cambio del CUIT quedó en audit_log'
);

select * from finish();
rollback;
