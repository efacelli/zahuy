-- v0.4 paso I: cierre de seguridad (contrato §9 y §12).
-- Controles transversales que valen para TODO el esquema, presentes y futuros:
-- si una migración nueva deja algo expuesto, alguna de estas pruebas falla.
-- Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- 1. Invariantes de todo el esquema public
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  0, 'todas las tablas de public tienen RLS activada'
);
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  0, 'todas las vistas de public usan security_invoker'
);
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
      and (has_table_privilege('anon', c.oid, 'select') and c.relkind <> 'S'
        or c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'usage'))),
  0, 'anon no puede leer ninguna tabla, vista ni secuencia de public'
);
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
      and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete'))),
  0, 'anon no puede escribir ninguna tabla de public'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no puede ejecutar ninguna función de public ni private'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
  0, 'toda función SECURITY DEFINER tiene search_path vacío'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and not p.prosecdef),
  0, 'todas las RPC de public son SECURITY DEFINER'
);
select is(has_schema_privilege('anon', 'private', 'usage'), false, 'anon no tiene acceso al esquema private');

-- ---------------------------------------------------------------------------
-- 2. Matriz de permisos de tabla para el rol de la app (authenticated)
-- ---------------------------------------------------------------------------
-- Qué operaciones directas existen. Las filas las decide la RLS; el rol dentro
-- de la app, las políticas y las RPC (probado en los archivos 02 a 13).
create temporary table t_expected (tbl text primary key, can_insert boolean, can_update boolean, can_delete boolean) on commit drop;
insert into t_expected values
  ('profiles', false, true, false),
  ('categories', true, true, false),
  ('brands', true, true, false),
  ('suppliers', true, true, false),
  ('products', false, true, false),
  ('product_batches', false, true, false),
  ('stock_movements', false, false, false),
  ('audit_log', false, false, false),
  ('expiry_alert_settings', true, true, true),
  -- Etapa 5 (ventas y caja): se escribe solo por RPC, salvo los catálogos y la configuración.
  ('payment_methods', true, true, false),
  ('cash_registers', true, true, false),
  ('sales_settings', false, true, false),
  ('cash_sessions', false, false, false),
  ('sales', false, false, false),
  ('sale_items', false, false, false),
  ('sale_payments', false, false, false);

select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname not in (select tbl from t_expected)),
  0, 'no hay tablas en public fuera de la matriz de permisos (agregar la tabla nueva a esta prueba)'
);
select is(
  (select count(*)::int from t_expected e
    where not has_table_privilege('authenticated', format('public.%I', e.tbl), 'select')),
  0, 'authenticated tiene SELECT en todas las tablas (las filas las filtra la RLS)'
);
select results_eq(
  $$select e.tbl,
           has_any_column_privilege('authenticated', format('public.%I', e.tbl), 'insert'),
           has_any_column_privilege('authenticated', format('public.%I', e.tbl), 'update'),
           has_table_privilege('authenticated', format('public.%I', e.tbl), 'delete')
    from t_expected e order by e.tbl$$,
  $$select tbl, can_insert, can_update, can_delete from t_expected order by tbl$$,
  'INSERT / UPDATE / DELETE directos: solo donde el contrato lo permite'
);

-- Columnas que el cliente nunca escribe.
select is(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name in (select tbl from t_expected)
      and c.column_name in ('id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'creation_key', 'sku',
                            'quantity_initial', 'quantity_available', 'product_id', 'sale_price_with_vat')
      and has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'update')),
  0, 'id, auditoría, SKU, clave de alta y saldos no se pueden actualizar desde la app'
);
select is(
  (select string_agg(c.column_name, ', ' order by c.column_name) from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'product_batches'
      and has_column_privilege('authenticated', 'public.product_batches', c.column_name, 'update')),
  'batch_number, expires_on, notes', 'de un lote solo se editan número, vencimiento y observaciones'
);
select is(
  (select string_agg(c.column_name, ', ' order by c.column_name) from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'profiles'
      and has_column_privilege('authenticated', 'public.profiles', c.column_name, 'update')),
  'full_name, is_active, role', 'de un perfil solo se editan nombre, estado y rol (y solo un admin, por RLS)'
);

-- ---------------------------------------------------------------------------
-- 3. Usuario inactivo: no lee nada (salvo su perfil) y toda RPC lo rechaza
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ea', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000eb', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000ec', 'ivan.inactivo@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000ea';
-- Era dueño: al desactivarlo pierde todo.
update public.profiles set role = 'admin', is_active = false where id = '00000000-0000-4000-8000-0000000000ec';

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ec", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$select id from public.profiles$$,
  $$values ('00000000-0000-4000-8000-0000000000ec'::uuid)$$,
  'inactivo: solo lee su propio perfil'
);
select is(
  (select (select count(*) from public.categories) + (select count(*) from public.brands) + (select count(*) from public.suppliers)
        + (select count(*) from public.products) + (select count(*) from public.product_batches)
        + (select count(*) from public.stock_movements) + (select count(*) from public.audit_log)
        + (select count(*) from public.expiry_alert_settings) + (select count(*) from public.v_product_list)
        + (select count(*) from public.v_product_stock) + (select count(*) from public.v_batch_status)
        + (select count(*) from public.v_inventory_summary)
        + (select count(*) from public.payment_methods) + (select count(*) from public.cash_registers)
        + (select count(*) from public.sales_settings) + (select count(*) from public.cash_sessions)
        + (select count(*) from public.sales) + (select count(*) from public.sale_items)
        + (select count(*) from public.sale_payments) + (select count(*) from public.v_cash_session_summary)
        + (select count(*) from public.v_cash_session_payments))::int,
  0, 'inactivo: no lee ninguna otra tabla ni vista (aunque su rol sea admin)'
);
select throws_ok(
  $$select public.create_product(gen_random_uuid(), 'X', gen_random_uuid(), gen_random_uuid(), 'unit', 1, 2, 21)$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: create_product → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), gen_random_uuid(), 1, null, date '2031-01-01')$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: receive_stock → NOT_AUTHORIZED'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), gen_random_uuid(), 'internal_use', 1, 'x')$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: register_product_movement → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), gen_random_uuid(), 'shrinkage', 1, 'x')$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: register_stock_movement → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), gen_random_uuid(), 'x')$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: reverse_stock_movement → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), gen_random_uuid(), 0)$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: open_cash_session → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), gen_random_uuid(), '[]', '[]')$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: register_sale → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.close_cash_session(gen_random_uuid(), 0)$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: close_cash_session → NOT_AUTHORIZED'
);
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), gen_random_uuid(), 'x')$$,
  'P0001', 'NOT_AUTHORIZED', 'inactivo: void_sale → NOT_AUTHORIZED'
);
reset role;

-- ---------------------------------------------------------------------------
-- 4. Bucket de imágenes (contrato §9)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images'$$,
  $$values (false, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp'])$$,
  'existe el bucket product-images, privado, con límite de tamaño y tipos de imagen'
);
select is(
  (select count(*)::int from storage.buckets where public),
  0, 'no hay ningún bucket público'
);

-- Encargado: sube.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ea", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values ('product-images', 'prueba/encargado.jpg', '00000000-0000-4000-8000-0000000000ea')$$,
  'el encargado sube una imagen a product-images'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values ('otro-bucket', 'prueba/x.jpg', '00000000-0000-4000-8000-0000000000ea')$$,
  null, null, 'el encargado no puede escribir en otro bucket'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'product-images' and name = 'prueba/encargado.jpg'),
  1, 'el encargado ve la imagen'
);
reset role;

-- Empleada: ve, no sube.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000eb", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'product-images' and name = 'prueba/encargado.jpg'),
  1, 'la empleada ve las imágenes'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values ('product-images', 'prueba/empleada.jpg', '00000000-0000-4000-8000-0000000000eb')$$,
  '42501', null, 'la empleada no sube imágenes'
);
-- El borrado se prueba por la API de Storage: Supabase no permite DELETE directo por SQL sobre storage.objects.
reset role;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'product-images' and name = 'prueba/encargado.jpg'),
  1, 'la imagen del encargado sigue ahí'
);

-- Inactivo y anon: no ven nada.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ec", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'product-images'), 0, 'el inactivo no ve imágenes');
reset role;

set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'product-images'), 0, 'anon no ve imágenes');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'prueba/anon.jpg')$$,
  '42501', null, 'anon no sube imágenes'
);
reset role;

select * from finish();
rollback;
