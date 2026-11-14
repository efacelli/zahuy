-- Paso B: enums, perfiles, RLS y privilegios por defecto.
-- Contrato v0.3.1 §4, §5.1, §9 y §12. Solo datos ficticios; todo se revierte.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select enum_has_labels('public', 'app_role', array['admin', 'manager', 'staff']);
select enum_has_labels('public', 'sale_unit', array['unit', 'kg', 'l', 'pack', 'box', 'other']);
select enum_has_labels(
  'public', 'movement_type',
  array['entry', 'exit', 'adjustment_in', 'adjustment_out', 'shrinkage', 'damage', 'customer_return', 'supplier_return']
);
select enum_has_labels(
  'public', 'expiry_status',
  array['depleted', 'no_expiry', 'expired', 'expires_7', 'expires_15', 'expires_30', 'ok']
);

select has_table('public', 'profiles', 'existe public.profiles');
select col_is_pk('public', 'profiles', 'id', 'profiles.id es la clave primaria');
select col_type_is('public', 'profiles', 'role', 'app_role', 'profiles.role es app_role');
select col_default_is('public', 'profiles', 'role', 'staff', 'el rol por defecto es staff');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'todas las tablas de public tienen RLS activada'
);

select is(
  private.today_ar(),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  'today_ar devuelve la fecha de Buenos Aires'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios: el trigger crea los perfiles
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'ana.admin@zahuy.test', '{"full_name": "Ana Admin"}'),
  ('00000000-0000-4000-8000-00000000000b', 'sergio.staff@zahuy.test', '{"role": "admin"}'),
  ('00000000-0000-4000-8000-00000000000c', 'ines.inactiva@zahuy.test', '{"full_name": "   "}'),
  ('00000000-0000-4000-8000-00000000000d', 'omar.otro@zahuy.test', jsonb_build_object('full_name', repeat('x', 200)));

select is(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-00000000000a'),
  'Ana Admin',
  'el nombre sale de los metadatos'
);
select is(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'sergio.staff',
  'sin nombre en los metadatos se usa la parte local del email'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'staff'::public.app_role,
  'el rol de los metadatos se ignora: nace como staff'
);
select is(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-00000000000c'),
  'ines.inactiva',
  'un nombre en blanco en los metadatos se ignora'
);
select is(
  (select length(full_name) from public.profiles where id = '00000000-0000-4000-8000-00000000000d'),
  120,
  'el nombre se recorta a 120 caracteres'
);
select is(
  (select count(*)::int from public.profiles where is_active and role = 'staff'),
  4,
  'los cuatro perfiles nacen activos y como staff'
);

-- Primer admin: se promueve por SQL con un rol privilegiado (sin sesión).
select lives_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000000a'$$,
  'un rol privilegiado de la base puede promover al primer admin'
);
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000000c';

select throws_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-00000000000b'$$,
  '23503',
  null,
  'no se puede borrar un usuario con perfil (ON DELETE RESTRICT)'
);

-- ---------------------------------------------------------------------------
-- anon: sin acceso
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon no puede leer profiles');
select throws_ok($$select private.is_admin()$$, '42501', null, 'anon no puede ejecutar funciones privadas');
reset role;

-- ---------------------------------------------------------------------------
-- staff activo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.profiles), 4, 'un usuario activo lee todos los perfiles');

select lives_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000000b'$$,
  'staff: intentar cambiarse el rol no da error (la RLS no le muestra filas editables)'
);
select lives_ok(
  $$update public.profiles set full_name = 'Hackeado' where id = '00000000-0000-4000-8000-00000000000d'$$,
  'staff: intentar editar otro perfil no da error'
);
select throws_ok(
  $$insert into public.profiles (id, full_name) values ('00000000-0000-4000-8000-00000000000e', 'Intruso')$$,
  '42501', null, 'staff no puede insertar perfiles'
);
select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-00000000000d'$$,
  '42501', null, 'staff no puede borrar perfiles'
);
select throws_ok(
  $$update public.profiles set created_at = now() where id = '00000000-0000-4000-8000-00000000000b'$$,
  '42501', null, 'el cliente no puede escribir created_at'
);
reset role;

select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'staff'::public.app_role,
  'staff no pudo cambiarse el rol'
);
select isnt(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-00000000000d'),
  'Hackeado',
  'staff no pudo editar el perfil de otro'
);

-- ---------------------------------------------------------------------------
-- usuario inactivo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select id from public.profiles$$,
  $$values ('00000000-0000-4000-8000-00000000000c'::uuid)$$,
  'un usuario inactivo solo lee su propio perfil'
);
reset role;

-- ---------------------------------------------------------------------------
-- admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update public.profiles set role = 'manager', full_name = 'Sergio Staff' where id = '00000000-0000-4000-8000-00000000000b'$$,
  'admin cambia el rol y el nombre de otro usuario'
);
select lives_ok(
  $$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000000d'$$,
  'admin desactiva a otro usuario'
);
select lives_ok(
  $$update public.profiles set full_name = 'Ana Administradora' where id = '00000000-0000-4000-8000-00000000000a'$$,
  'admin edita su propio nombre'
);
select throws_ok(
  $$update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-00000000000a'$$,
  'P0001', 'NOT_AUTHORIZED', 'admin no puede quitarse el rol a sí mismo'
);
select throws_ok(
  $$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000000a'$$,
  'P0001', 'NOT_AUTHORIZED', 'admin no puede desactivarse a sí mismo'
);
select throws_ok(
  $$update public.profiles set full_name = '   ' where id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', null, 'el nombre no puede quedar en blanco'
);
select throws_ok(
  $$update public.profiles set id = '00000000-0000-4000-8000-00000000000f' where id = '00000000-0000-4000-8000-00000000000b'$$,
  '42501', null, 'ni el admin puede cambiar el id'
);
select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-00000000000d'$$,
  '42501', null, 'ni el admin puede borrar perfiles'
);
reset role;

select results_eq(
  $$select role, full_name, is_active from public.profiles where id = '00000000-0000-4000-8000-00000000000b'$$,
  $$values ('manager'::public.app_role, 'Sergio Staff', true)$$,
  'los cambios del admin quedaron guardados'
);
select is(
  (select is_active from public.profiles where id = '00000000-0000-4000-8000-00000000000d'),
  false,
  'el usuario quedó desactivado'
);

-- El usuario recién desactivado deja de ver a los demás.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.profiles), 1, 'al desactivarlo, solo ve su propio perfil');
reset role;

-- ---------------------------------------------------------------------------
-- Endurecimiento general
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'anon no puede ejecutar ninguna función de public ni private'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
  0,
  'toda función SECURITY DEFINER tiene search_path vacío'
);

-- Los objetos nuevos de public nacen sin permisos para anon y authenticated.
create table public.zz_default_privileges_probe (id integer);
select is(
  has_table_privilege('anon', 'public.zz_default_privileges_probe', 'select')
    or has_table_privilege('authenticated', 'public.zz_default_privileges_probe', 'select')
    or has_table_privilege('authenticated', 'public.zz_default_privileges_probe', 'insert'),
  false,
  'una tabla nueva en public no queda expuesta por defecto'
);

select * from finish();
rollback;
