-- v0.7.1 (P-44): el rol "Programador" (developer) tiene los mismos permisos que el dueño.
-- Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select enum_has_labels(
  'public', 'app_role',
  array['admin', 'manager', 'staff', 'developer'],
  'app_role incluye developer (Programador)'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000019a', 'pablo.programador@zahuy.test'),
  ('00000000-0000-4000-8000-00000000019b', 'esteban.empleado@zahuy.test'),
  ('00000000-0000-4000-8000-00000000019c', 'pia.programadora.inactiva@zahuy.test');
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-00000000019a';
update public.profiles set role = 'developer', is_active = false where id = '00000000-0000-4000-8000-00000000019c';

-- Un cambio auditable para que haya algo que leer.
insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000019c1', 'Categoría programador');

-- ---------------------------------------------------------------------------
-- Programador activo: lo mismo que el dueño
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000019a", "role": "authenticated"}', true);
set local role authenticated;

select ok(private.is_admin(), 'el programador cuenta como dueño');
select ok(private.is_manager_or_admin(), 'el programador cuenta como encargado o dueño');
select ok(private.can_manage_inventory(), 'el programador gestiona el inventario');
select cmp_ok((select count(*)::int from public.audit_log), '>', 0, 'el programador lee la auditoría');
select lives_ok(
  $$update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000019b'$$,
  'el programador cambia el rol de otro usuario'
);
select lives_ok(
  $$insert into public.brands (name) values ('Marca del programador')$$,
  'el programador crea catálogos'
);

reset role;
select is(
  (select role::text from public.profiles where id = '00000000-0000-4000-8000-00000000019b'),
  'manager',
  'el cambio de rol quedó guardado'
);

-- ---------------------------------------------------------------------------
-- Programador inactivo: nada
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000019c", "role": "authenticated"}', true);
set local role authenticated;

select ok(not private.is_admin(), 'un programador desactivado no cuenta como dueño');
select ok(not private.is_manager_or_admin(), 'un programador desactivado no gestiona');
select is((select count(*)::int from public.audit_log), 0, 'un programador desactivado no lee la auditoría');

reset role;

-- ---------------------------------------------------------------------------
-- Un empleado no se puede asignar el rol
-- ---------------------------------------------------------------------------
-- Preparación como la base (sin usuario): vuelve a ser empleado.
select set_config('request.jwt.claims', '', true);
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-00000000019b';
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000019b", "role": "authenticated"}', true);
set local role authenticated;
-- Como en 01: la RLS no le muestra filas editables, así que no da error pero no cambia nada.
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-00000000019b';
reset role;
select is(
  (select role::text from public.profiles where id = '00000000-0000-4000-8000-00000000019b'),
  'staff',
  'un empleado no se puede asignar el rol de programador'
);

select * from finish();
rollback;
