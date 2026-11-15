-- v0.4 paso E: expiry_alert_settings.
-- Contrato v0.4.x §5.9, §9 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura y fila general
-- ---------------------------------------------------------------------------
select has_table('public', 'expiry_alert_settings', 'existe expiry_alert_settings');
select index_is_unique('public', 'expiry_alert_settings', 'expiry_alert_settings_category_key', 'índice único por categoría');
select is(
  (select relrowsecurity from pg_class where oid = 'public.expiry_alert_settings'::regclass),
  true, 'RLS activada'
);
select results_eq(
  $$select urgent_days, soon_days, notice_days from public.expiry_alert_settings where category_id is null$$,
  $$values (7, 15, 30)$$,
  'la migración crea la fila general 7 / 15 / 30'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000009a', 'dora.duena@zahuy.test'),
  ('00000000-0000-4000-8000-00000000009b', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-00000000009c', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-00000000009d', 'ivan.inactivo@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000009a';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-00000000009b';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000009d';

insert into public.categories (id, name) values
  ('00000000-0000-4000-8000-0000000009c1', 'Lácteos paso E'),
  ('00000000-0000-4000-8000-0000000009c2', 'Limpieza paso E');

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Restricciones (como rol privilegiado).
select is(pg_temp.try($$insert into public.expiry_alert_settings (category_id) values (null)$$), '23505', 'no puede haber dos filas generales');
select is(
  pg_temp.try($$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', -1, 15, 30)$$),
  '23514', 'urgent_days negativo'
);
select is(
  pg_temp.try($$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', 10, 9, 30)$$),
  '23514', 'soon_days menor que urgent_days'
);
select is(
  pg_temp.try($$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', 10, 20, 19)$$),
  '23514', 'notice_days menor que soon_days'
);
select is(
  pg_temp.try($$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', 10, 20, 366)$$),
  '23514', 'notice_days mayor que 365'
);
select is(
  pg_temp.try($$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-00000000dead', 10, 20, 45)$$),
  '23503', 'categoría inexistente'
);
select is(
  pg_temp.try($$delete from public.expiry_alert_settings where category_id is null$$),
  '23514', 'la fila general no se borra, ni con un rol privilegiado'
);
select is(
  pg_temp.try($$update public.expiry_alert_settings set category_id = '00000000-0000-4000-8000-0000000009c1' where category_id is null$$),
  '23514', 'la fila general no se convierte en excepción de una categoría'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.expiry_alert_settings$$, '42501', null, 'anon no lee la configuración');
reset role;

-- ---------------------------------------------------------------------------
-- Empleada: solo lee
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000009c", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.expiry_alert_settings where category_id is null), 1, 'empleada lee la configuración');
select throws_ok(
  $$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', 10, 20, 45)$$,
  '42501', null, 'empleada no crea excepciones'
);
select lives_ok(
  $$update public.expiry_alert_settings set urgent_days = 1 where category_id is null$$,
  'empleada: editar no da error (sin filas editables)'
);
reset role;

select is(
  (select urgent_days from public.expiry_alert_settings where category_id is null),
  7, 'la empleada no cambió la configuración general'
);

-- ---------------------------------------------------------------------------
-- Encargado: crea, edita y borra excepciones
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000009b", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', 10, 20, 45)$$,
  'encargado crea la excepción de una categoría'
);
select throws_ok(
  $$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c1', 5, 10, 15)$$,
  '23505', 'duplicate key value violates unique constraint "expiry_alert_settings_category_key"',
  'una sola excepción por categoría'
);
select lives_ok(
  $$insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
    values ('00000000-0000-4000-8000-0000000009c2', 30, 60, 180)$$,
  'encargado crea otra excepción'
);
select lives_ok(
  $$update public.expiry_alert_settings set urgent_days = 5, soon_days = 10, notice_days = 20 where category_id is null$$,
  'encargado edita la configuración general'
);
select throws_ok(
  $$update public.expiry_alert_settings set soon_days = 1 where category_id is null$$,
  '23514', null, 'la edición respeta urgent <= soon <= notice'
);
select throws_ok(
  $$update public.expiry_alert_settings set category_id = null where category_id = '00000000-0000-4000-8000-0000000009c2'$$,
  '42501', null, 'category_id no se edita desde la app'
);
select throws_ok(
  $$update public.expiry_alert_settings set created_by = null where category_id is null$$,
  '42501', null, 'las columnas de auditoría no se escriben desde la app'
);
select lives_ok(
  $$delete from public.expiry_alert_settings where category_id = '00000000-0000-4000-8000-0000000009c2'$$,
  'encargado borra la excepción de una categoría'
);
select lives_ok(
  $$delete from public.expiry_alert_settings where category_id is null$$,
  'encargado: borrar la fila general no da error (la política no se la ofrece)'
);
reset role;

select results_eq(
  $$select coalesce(c.name, '(general)'), s.urgent_days, s.soon_days, s.notice_days, s.updated_by
    from public.expiry_alert_settings s left join public.categories c on c.id = s.category_id
    where s.category_id is null or s.category_id in ('00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009c2')
    order by 1$$,
  $$values ('(general)', 5, 10, 20, '00000000-0000-4000-8000-00000000009b'::uuid),
           ('Lácteos paso E', 10, 20, 45, '00000000-0000-4000-8000-00000000009b'::uuid)$$,
  'quedaron la fila general editada y una excepción; la otra se borró y la general sigue'
);

-- ---------------------------------------------------------------------------
-- Dueña: igual que el encargado, y ve la auditoría
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000009a", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$update public.expiry_alert_settings set notice_days = 60 where category_id = '00000000-0000-4000-8000-0000000009c1'$$,
  'dueña edita una excepción'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'expiry_alert_settings' and changed_by = '00000000-0000-4000-8000-00000000009b'),
  4, 'las dos altas, la edición y el borrado del encargado quedaron auditados (P-22, v0.4.4)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Inactivo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000009d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.expiry_alert_settings), 0, 'inactivo no lee la configuración');
reset role;

select * from finish();
rollback;
