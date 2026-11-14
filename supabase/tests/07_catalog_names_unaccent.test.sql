-- v0.4 paso C: nombres de catálogos únicos sin distinguir tildes.
-- Contrato v0.4.x §5.2–5.4 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Función e índices
-- ---------------------------------------------------------------------------
select is(private.unaccent_text('Lácteos'), 'Lacteos', 'quita la tilde');
select is(private.unaccent_text('ÁÉÍÓÚ áéíóú Üü'), 'AEIOU aeiou Uu', 'quita tildes y diéresis');
select is(private.unaccent_text(null), null, 'nulo devuelve nulo');
select is(
  (select provolatile::text from pg_proc where oid = 'private.unaccent_text(text)'::regprocedure),
  'i', 'unaccent_text es IMMUTABLE'
);
select is(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'private.unaccent_text(text)'::regprocedure),
  true, 'unaccent_text tiene search_path vacío'
);

select index_is_unique('public', 'categories', 'categories_name_key', 'categories_name_key sigue existiendo y es único');
select index_is_unique('public', 'brands', 'brands_name_key', 'brands_name_key sigue existiendo y es único');
select index_is_unique('public', 'suppliers', 'suppliers_name_key', 'suppliers_name_key sigue existiendo y es único');
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and indexname in ('categories_name_key', 'brands_name_key', 'suppliers_name_key')
      and indexdef like '%unaccent_text%'),
  3, 'los tres índices usan unaccent_text'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname like '%_name_key_unaccent'),
  0, 'no quedaron índices con nombre temporal'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000007b', 'enzo.encargado@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000007b';

-- Como encargado: el índice evalúa la función con el rol de quien escribe.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000007b", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok($$insert into public.categories (name) values ('Lácteos C')$$, 'encargado crea una categoría con tilde');
select throws_ok(
  $$insert into public.categories (name) values ('lacteos c')$$,
  '23505', 'duplicate key value violates unique constraint "categories_name_key"',
  '"lacteos" contra "Lácteos" → 23505 sobre categories_name_key'
);
select throws_ok(
  $$insert into public.categories (name) values ('  LÁCTEOS C ')$$,
  '23505', 'duplicate key value violates unique constraint "categories_name_key"',
  '"LÁCTEOS" con espacios contra "Lácteos"'
);
select throws_ok(
  $$insert into public.categories (name) values ('LACTEOS C')$$,
  '23505', 'duplicate key value violates unique constraint "categories_name_key"',
  '"LACTEOS" sin tilde y en mayúsculas'
);
select lives_ok($$insert into public.categories (name) values ('Lácteos C frescos')$$, 'un nombre distinto sí se acepta');

select lives_ok($$insert into public.brands (name) values ('Señor Café C')$$, 'encargado crea una marca');
select throws_ok(
  $$insert into public.brands (name) values ('senor cafe c')$$,
  '23505', 'duplicate key value violates unique constraint "brands_name_key"',
  'marca: la ñ y la tilde no distinguen'
);

select lives_ok($$insert into public.suppliers (name) values ('Distribución Güemes C')$$, 'encargado crea un proveedor');
select throws_ok(
  $$insert into public.suppliers (name) values ('DISTRIBUCION GUEMES C')$$,
  '23505', 'duplicate key value violates unique constraint "suppliers_name_key"',
  'proveedor: tilde y diéresis no distinguen'
);

-- Renombrar a un nombre que choca.
select throws_ok(
  $$update public.categories set name = 'Lacteos C' where name = 'Lácteos C frescos'$$,
  '23505', 'duplicate key value violates unique constraint "categories_name_key"',
  'renombrar a un nombre que solo difiere en la tilde'
);
-- Corregir la tilde del propio registro sí se puede.
select lives_ok(
  $$update public.categories set name = 'Lacteos C' where name = 'Lácteos C'$$,
  'quitarle la tilde al propio registro se acepta'
);
reset role;

select is(
  (select count(*)::int from public.categories where lower(private.unaccent_text(trim(name))) = 'lacteos c'),
  1, 'quedó una sola categoría con ese nombre'
);

-- El nombre se guarda como se escribió: la regla solo afecta a la unicidad.
select is(
  (select name from public.brands where name like 'Señor%'),
  'Señor Café C', 'el nombre conserva sus tildes'
);

set local role anon;
select throws_ok($$select private.unaccent_text('á')$$, '42501', null, 'anon no ejecuta unaccent_text');
reset role;

select * from finish();
rollback;
