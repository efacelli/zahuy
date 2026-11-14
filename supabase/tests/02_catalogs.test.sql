-- Paso C: categorías, marcas y proveedores.
-- Contrato v0.3.1 §2.5, §2.6, §5.2–5.4, §9 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura y nombres del contrato
-- ---------------------------------------------------------------------------
select has_table('public', 'categories', 'existe categories');
select has_table('public', 'brands', 'existe brands');
select has_table('public', 'suppliers', 'existe suppliers');

select index_is_unique('public', 'categories', 'categories_name_key', 'categories_name_key es único');
select index_is_unique('public', 'brands', 'brands_name_key', 'brands_name_key es único');
select index_is_unique('public', 'suppliers', 'suppliers_name_key', 'suppliers_name_key es único');
select index_is_unique('public', 'suppliers', 'suppliers_tax_id_key', 'suppliers_tax_id_key es único');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'todas las tablas de public tienen RLS activada'
);

-- ---------------------------------------------------------------------------
-- Usuarios ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000001a', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-00000000001b', 'bruno.empleado@zahuy.test'),
  ('00000000-0000-4000-8000-00000000001c', 'ines.inactiva@zahuy.test');
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000001c';

-- Semilla o migración (sin sesión): se permite y queda sin autor.
insert into public.categories (name) values ('Almacén');
select is(
  (select created_by from public.categories where name = 'Almacén'),
  null,
  'una fila creada sin sesión queda con created_by nulo'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.categories$$, '42501', null, 'anon no lee categories');
select throws_ok($$select * from public.brands$$, '42501', null, 'anon no lee brands');
select throws_ok($$select * from public.suppliers$$, '42501', null, 'anon no lee suppliers');
select throws_ok($$insert into public.categories (name) values ('Intrusa')$$, '42501', null, 'anon no inserta');
reset role;

-- ---------------------------------------------------------------------------
-- Empleada activa: crea, lee y edita
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000001a", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok($$insert into public.categories (name) values ('Lácteos')$$, 'crea una categoría');
select lives_ok($$insert into public.brands (name) values ('La Serenísima Ficticia')$$, 'crea una marca');
select lives_ok(
  $$insert into public.suppliers (name, tax_id, phone, email, notes)
    values ('Distribuidora Ficticia SA', '30712345678', '011 5555-0000', 'ventas@ficticia.test', 'Entrega los martes')$$,
  'crea un proveedor con todos los datos'
);
select lives_ok($$insert into public.suppliers (name) values ('Proveedor Sin CUIT Uno')$$, 'proveedor sin CUIT');
select lives_ok($$insert into public.suppliers (name) values ('Proveedor Sin CUIT Dos')$$, 'dos proveedores sin CUIT no chocan');

select is(
  (select count(*)::int from public.categories where name in ('Almacén', 'Lácteos')),
  2,
  'lee las categorías'
);

-- Duplicados: el nombre de la restricción es el que traduce el frontend.
select throws_ok(
  $$insert into public.categories (name) values ('  LÁCTEOS ')$$,
  '23505', 'duplicate key value violates unique constraint "categories_name_key"',
  'categoría duplicada sin distinguir mayúsculas ni espacios'
);
select throws_ok(
  $$insert into public.brands (name) values ('la serenísima ficticia')$$,
  '23505', 'duplicate key value violates unique constraint "brands_name_key"',
  'marca duplicada'
);
select throws_ok(
  $$insert into public.suppliers (name) values ('DISTRIBUIDORA FICTICIA SA')$$,
  '23505', 'duplicate key value violates unique constraint "suppliers_name_key"',
  'proveedor duplicado por nombre'
);
select throws_ok(
  $$insert into public.suppliers (name, tax_id) values ('Otra Razón Social', '30712345678')$$,
  '23505', 'duplicate key value violates unique constraint "suppliers_tax_id_key"',
  'proveedor duplicado por CUIT'
);

-- Validaciones
select throws_ok($$insert into public.categories (name) values ('   ')$$, '23514', null, 'nombre en blanco');
select throws_ok(
  $$insert into public.categories (name) values (repeat('x', 81))$$, '23514', null, 'categoría de más de 80 caracteres'
);
select lives_ok(
  $$insert into public.suppliers (name) values (repeat('p', 120))$$, 'proveedor de 120 caracteres'
);
select throws_ok(
  $$insert into public.suppliers (name) values (repeat('q', 121))$$, '23514', null, 'proveedor de más de 120 caracteres'
);
select throws_ok(
  $$insert into public.suppliers (name, tax_id) values ('CUIT con guiones', '30-71234567-8')$$,
  '23514', null, 'CUIT con guiones'
);
select throws_ok(
  $$insert into public.suppliers (name, tax_id) values ('CUIT corto', '3071234567')$$,
  '23514', null, 'CUIT de 10 dígitos'
);
select throws_ok(
  $$insert into public.suppliers (name, email) values ('Email malo', 'sin-arroba.test')$$,
  '23514', null, 'email sin formato'
);
select throws_ok(
  $$insert into public.suppliers (name, email) values ('Email vacío', '')$$,
  '23514', null, 'email vacío (debe ser nulo)'
);
select throws_ok(
  $$insert into public.suppliers (name, phone) values ('Teléfono largo', repeat('1', 41))$$,
  '23514', null, 'teléfono de más de 40 caracteres'
);
select throws_ok(
  $$insert into public.suppliers (name, notes) values ('Notas largas', repeat('n', 1001))$$,
  '23514', null, 'notas de más de 1000 caracteres'
);

-- Columnas de auditoría: el cliente no las puede enviar.
select throws_ok(
  $$insert into public.categories (name, created_by) values ('Falsificada', '00000000-0000-4000-8000-00000000001b')$$,
  '42501', null, 'no se puede enviar created_by'
);
select throws_ok(
  $$insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000000ff', 'Con id')$$,
  '42501', null, 'no se puede enviar id'
);
select throws_ok(
  $$update public.categories set updated_by = '00000000-0000-4000-8000-00000000001b' where name = 'Lácteos'$$,
  '42501', null, 'no se puede enviar updated_by'
);
select throws_ok(
  $$update public.categories set created_at = '2000-01-01' where name = 'Lácteos'$$,
  '42501', null, 'no se puede enviar created_at'
);

-- Nadie borra.
select throws_ok($$delete from public.categories where name = 'Lácteos'$$, '42501', null, 'no se borra una categoría');
select throws_ok($$delete from public.brands$$, '42501', null, 'no se borra una marca');
select throws_ok($$delete from public.suppliers$$, '42501', null, 'no se borra un proveedor');

-- Lectura como la hace el frontend: opciones activas ordenadas por nombre.
select results_eq(
  $$select name from public.categories where is_active and name in ('Almacén', 'Lácteos') order by name$$,
  $$values ('Almacén'), ('Lácteos')$$,
  'opciones activas ordenadas por nombre'
);
reset role;

select is(
  (select created_by from public.categories where name = 'Lácteos'),
  '00000000-0000-4000-8000-00000000001a'::uuid,
  'created_by lo fija la base con el usuario de la sesión'
);
select is(
  (select updated_by from public.suppliers where name = 'Distribuidora Ficticia SA'),
  '00000000-0000-4000-8000-00000000001a'::uuid,
  'updated_by inicial es quien creó la fila'
);

-- ---------------------------------------------------------------------------
-- Otro empleado edita y desactiva
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000001b", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update public.categories set name = 'Lácteos y quesos' where name = 'Lácteos'$$, 'otro empleado renombra'
);
select lives_ok(
  $$update public.suppliers set is_active = false, phone = null where name = 'Distribuidora Ficticia SA'$$,
  'otro empleado desactiva un proveedor'
);
select throws_ok(
  $$update public.categories set name = 'ALMACÉN' where name = 'Lácteos y quesos'$$,
  '23505', 'duplicate key value violates unique constraint "categories_name_key"',
  'renombrar a un nombre existente'
);
select results_eq(
  $$select name from public.suppliers where is_active and name like 'Distribuidora%'$$,
  $$select null::text where false$$,
  'el proveedor desactivado no aparece entre los activos'
);
reset role;

select results_eq(
  $$select created_by, updated_by from public.categories where name = 'Lácteos y quesos'$$,
  $$values ('00000000-0000-4000-8000-00000000001a'::uuid, '00000000-0000-4000-8000-00000000001b'::uuid)$$,
  'created_by se conserva y updated_by registra a quien editó'
);

-- ---------------------------------------------------------------------------
-- Usuario inactivo: no lee ni escribe
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000001c", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.categories), 0, 'inactivo no lee categories');
select is((select count(*)::int from public.brands), 0, 'inactivo no lee brands');
select is((select count(*)::int from public.suppliers), 0, 'inactivo no lee suppliers');
select throws_ok(
  $$insert into public.categories (name) values ('De un inactivo')$$, '42501', null, 'inactivo no inserta'
);
select lives_ok(
  $$update public.categories set name = 'Cambiada por inactivo' where true$$,
  'inactivo: el UPDATE no da error porque no ve filas'
);
reset role;

select is(
  (select count(*)::int from public.categories where name = 'Cambiada por inactivo'),
  0,
  'el inactivo no modificó nada'
);

-- No se puede borrar un perfil que es autor de un registro.
select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-00000000001a'$$,
  '23503', null, 'un perfil con registros a su nombre no se puede borrar'
);

select * from finish();
rollback;
