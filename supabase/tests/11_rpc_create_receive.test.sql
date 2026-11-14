-- v0.4 paso G (1 de 2): create_product y receive_stock.
-- Contrato v0.4.x §8.1, §8.4, §8.5, §8.6, §9 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Endurecimiento de las funciones
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('create_product', 'receive_stock')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  2, 'las dos RPC son SECURITY DEFINER con search_path vacío'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('create_product', 'receive_stock')
      and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'EXECUTE solo para authenticated (ni anon ni PUBLIC)'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_product'),
  'p_idempotency_key uuid, p_name text, p_category_id uuid, p_brand_id uuid, p_sale_unit sale_unit, p_cost_price numeric, '
  || 'p_sale_price numeric, p_vat_rate numeric, p_barcode text, p_description text, p_supplier_id uuid, '
  || 'p_boxes_quantity integer, p_units_per_box integer, p_min_stock numeric, p_is_active boolean, p_image_path text, '
  || 'p_initial_quantity numeric, p_received_on date, p_expires_on date, p_batch_number text',
  'create_product tiene los parámetros del contrato (sin p_sku, con p_units_per_box)'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'receive_stock'),
  'p_idempotency_key uuid, p_product_id uuid, p_quantity numeric, p_received_on date, p_expires_on date, '
  || 'p_batch_number text, p_notes text',
  'receive_stock tiene los parámetros del contrato'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ba', 'dora.duena@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000bb', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000bc', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000bd', 'ivan.inactivo@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000ba';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000bb';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000bd';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000b0c1', 'Categoría RPC');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000b0b1', 'Marca RPC');
insert into public.suppliers (id, name) values ('00000000-0000-4000-8000-00000000b0d1', 'Proveedor RPC');

create temporary table t_product (step text primary key, id uuid, sku text) on commit drop;
create temporary table t_movement (step text primary key, id uuid, batch_id uuid) on commit drop;
grant all on t_product, t_movement to authenticated;

-- Sin sesión (rol privilegiado sin usuario): no autorizado.
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c001', 'Sin sesión', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21)$$,
  'P0001', 'NOT_AUTHORIZED', 'create_product sin sesión → NOT_AUTHORIZED'
);

-- anon no puede ni ejecutar.
set local role anon;
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c001', 'Anon', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21)$$,
  '42501', null, 'anon no ejecuta create_product'
);
select throws_ok(
  $$select public.receive_stock('00000000-0000-4000-8000-00000000c001', gen_random_uuid(), 1)$$,
  '42501', null, 'anon no ejecuta receive_stock'
);
reset role;

-- ---------------------------------------------------------------------------
-- create_product: permisos
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000bc", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c001', 'De empleada', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21)$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no crea productos'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000bd", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c001', 'De inactivo', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21)$$,
  'P0001', 'NOT_AUTHORIZED', 'un encargado inactivo no crea productos'
);
select throws_ok(
  $$select public.receive_stock('00000000-0000-4000-8000-00000000c001', gen_random_uuid(), 1, null, date '2030-01-01')$$,
  'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo no registra ingresos'
);
reset role;

-- ---------------------------------------------------------------------------
-- create_product: como encargado
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000bb", "role": "authenticated"}', true);
set local role authenticated;

-- Alta mínima, sin stock.
insert into t_product
select 'a', (r).id, (r).sku
from (select public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000c00a', p_name => '  Yerba RPC 1 kg  ',
  p_category_id => '00000000-0000-4000-8000-00000000b0c1', p_brand_id => '00000000-0000-4000-8000-00000000b0b1',
  p_sale_unit => 'unit', p_cost_price => 1000, p_sale_price => 1500, p_vat_rate => 21) as r) x;

select matches((select sku from t_product where step = 'a'), '^[0-9]{6}$', 'el SKU lo asigna la base (6 dígitos)');
select results_eq(
  $$select name, units_per_box, boxes_quantity, min_stock, is_active, sale_price_with_vat, creation_key, created_by,
           barcode is null, supplier_id is null
    from public.products where id = (select id from t_product where step = 'a')$$,
  $$values ('Yerba RPC 1 kg', 12, 0, 0.000::numeric(12,3), true, 1815.00::numeric(12,2),
            '00000000-0000-4000-8000-00000000c00a'::uuid, '00000000-0000-4000-8000-0000000000bb'::uuid, true, true)$$,
  'alta mínima: nombre recortado, valores por defecto, precio final, clave y autor'
);
select is(
  (select count(*)::int from public.product_batches where product_id = (select id from t_product where step = 'a')),
  0, 'sin cantidad inicial no se crean lotes'
);

-- Reintento con la misma clave y el mismo nombre (otras mayúsculas y espacios).
insert into t_product
select 'a-retry', (r).id, (r).sku
from (select public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000c00a', p_name => 'YERBA rpc 1 KG',
  p_category_id => '00000000-0000-4000-8000-00000000b0c1', p_brand_id => '00000000-0000-4000-8000-00000000b0b1',
  p_sale_unit => 'unit', p_cost_price => 1000, p_sale_price => 1500, p_vat_rate => 21) as r) x;

select results_eq(
  $$select id, sku from t_product where step = 'a-retry'$$,
  $$select id, sku from t_product where step = 'a'$$,
  'el reintento devuelve el mismo producto con el mismo SKU'
);
select is(
  (select count(*)::int from public.products where creation_key = '00000000-0000-4000-8000-00000000c00a'),
  1, 'el reintento no creó otro producto'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00a', 'Otro nombre', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1000, 1500, 21)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otro nombre → IDEMPOTENCY_CONFLICT'
);

-- Alta completa con stock inicial.
insert into t_product
select 'b', (r).id, (r).sku
from (select public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000c00b', p_name => 'Queso RPC',
  p_category_id => '00000000-0000-4000-8000-00000000b0c1', p_brand_id => '00000000-0000-4000-8000-00000000b0b1',
  p_sale_unit => 'kg', p_cost_price => 5000, p_sale_price => 8000, p_vat_rate => 10.5,
  p_barcode => '7790000000994', p_description => 'Horma', p_supplier_id => '00000000-0000-4000-8000-00000000b0d1',
  p_boxes_quantity => 2, p_units_per_box => 4, p_min_stock => 1.5, p_is_active => true, p_image_path => null,
  p_initial_quantity => 12.255, p_received_on => null, p_expires_on => date '2031-03-31', p_batch_number => ' L-77 ') as r) x;

select is(
  (select sku::int from t_product where step = 'b'),
  (select sku::int + 1 from t_product where step = 'a'),
  'el reintento anterior no consumió otro número de SKU'
);
select results_eq(
  $$select b.batch_number, b.received_on, b.expires_on, b.quantity_initial, b.quantity_available,
           m.movement_type::text, m.quantity, m.batch_quantity_after, m.idempotency_key, m.created_by
    from public.product_batches b join public.stock_movements m on m.batch_id = b.id
    where b.product_id = (select id from t_product where step = 'b')$$,
  $$values ('L-77', private.today_ar(), date '2031-03-31', 12.255::numeric(12,3), 12.255::numeric(12,3),
            'entry', 12.255::numeric(12,3), 12.255::numeric(12,3), '00000000-0000-4000-8000-00000000c00b'::uuid,
            '00000000-0000-4000-8000-0000000000bb'::uuid)$$,
  'con cantidad inicial crea el lote y su movimiento entry con la misma clave'
);
select results_eq(
  $$select stock_quantity, units_in_boxes, loose_units, sale_price_with_vat
    from public.v_product_list where id = (select id from t_product where step = 'b')$$,
  $$values (12.255::numeric(12,3), 8.000::numeric(12,3), 4.255::numeric(12,3), 8840.00::numeric(12,2))$$,
  'el listado muestra el stock inicial y el precio final'
);

-- Validaciones del stock inicial: no se crea nada.
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Sin vencimiento RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21, p_initial_quantity => 5)$$,
  'P0001', 'EXPIRY_REQUIRED', 'stock inicial sin vencimiento → EXPIRY_REQUIRED'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Decimales RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21, p_initial_quantity => 1.5, p_expires_on => date '2031-01-01')$$,
  'P0001', 'INVALID_QUANTITY', 'decimales en un producto por unidad → INVALID_QUANTITY'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Cuatro decimales RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'kg', 1, 2, 21, p_initial_quantity => 1.2555, p_expires_on => date '2031-01-01')$$,
  'P0001', 'INVALID_QUANTITY', 'más de 3 decimales → INVALID_QUANTITY'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Negativo RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21, p_initial_quantity => -3, p_expires_on => date '2031-01-01')$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad inicial negativa → INVALID_QUANTITY'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Futuro RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21, p_initial_quantity => 3,
      p_received_on => private.today_ar() + 1, p_expires_on => date '2031-01-01')$$,
  'P0001', 'INVALID_DATE', 'fecha de ingreso futura → INVALID_DATE'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Barcode repetido RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21, p_barcode => '7790000000994')$$,
  '23505', 'duplicate key value violates unique constraint "products_barcode_key"',
  'código de barras repetido → 23505 sobre products_barcode_key'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'IVA 27 RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 27)$$,
  '23514', null, 'IVA no admitido → 23514'
);
select throws_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00c', 'Categoría inexistente RPC', '00000000-0000-4000-8000-00000000dead',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21)$$,
  '23503', null, 'categoría inexistente → 23503'
);
select is(
  (select count(*)::int from public.products where creation_key = '00000000-0000-4000-8000-00000000c00c'),
  0, 'ninguna de las altas fallidas dejó un producto'
);

-- Cantidad inicial 0: se crea sin lotes. Fecha pasada: se acepta.
insert into t_product
select 'c', (r).id, (r).sku
from (select public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000c00d', p_name => 'Cero RPC',
  p_category_id => '00000000-0000-4000-8000-00000000b0c1', p_brand_id => '00000000-0000-4000-8000-00000000b0b1',
  p_sale_unit => 'unit', p_cost_price => 1, p_sale_price => 2, p_vat_rate => 21, p_initial_quantity => 0) as r) x;
select is(
  (select count(*)::int from public.product_batches where product_id = (select id from t_product where step = 'c')),
  0, 'cantidad inicial 0 → sin lotes'
);
insert into t_product
select 'd', (r).id, (r).sku
from (select public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000c00e', p_name => 'Inactivo RPC',
  p_category_id => '00000000-0000-4000-8000-00000000b0c1', p_brand_id => '00000000-0000-4000-8000-00000000b0b1',
  p_sale_unit => 'unit', p_cost_price => 1, p_sale_price => 2, p_vat_rate => 21, p_is_active => false,
  p_initial_quantity => 6, p_received_on => private.today_ar() - 3, p_expires_on => date '2031-01-01') as r) x;
select is(
  (select received_on from public.product_batches where product_id = (select id from t_product where step = 'd')),
  private.today_ar() - 3, 'fecha de ingreso pasada: se guarda como se envió'
);
reset role;

-- La dueña también crea.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ba", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_product('00000000-0000-4000-8000-00000000c00f', 'De la dueña RPC', '00000000-0000-4000-8000-00000000b0c1',
      '00000000-0000-4000-8000-00000000b0b1', 'unit', 1, 2, 21)$$,
  'la dueña crea productos'
);
reset role;

-- ---------------------------------------------------------------------------
-- receive_stock: la empleada registra ingresos
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000bc", "role": "authenticated"}', true);
set local role authenticated;

insert into t_movement
select 'r1', (r).id, (r).batch_id
from (select public.receive_stock(
  p_idempotency_key => '00000000-0000-4000-8000-00000000c101',
  p_product_id => (select id from t_product where step = 'a'), p_quantity => 24,
  p_received_on => null, p_expires_on => date '2030-12-31', p_batch_number => 'L-2030', p_notes => 'Remito 0001-00000123') as r) x;

select results_eq(
  $$select m.movement_type::text, m.quantity, m.signed_quantity, m.batch_quantity_after, m.created_by, m.notes,
           m.operation_key is null, b.batch_number, b.expires_on, b.received_on, b.quantity_initial, b.created_by
    from public.stock_movements m join public.product_batches b on b.id = m.batch_id
    where m.id = (select id from t_movement where step = 'r1')$$,
  $$values ('entry', 24.000::numeric(12,3), 24.000::numeric(12,3), 24.000::numeric(12,3),
            '00000000-0000-4000-8000-0000000000bc'::uuid, 'Remito 0001-00000123', true, 'L-2030', date '2030-12-31',
            private.today_ar(), 24.000::numeric(12,3), '00000000-0000-4000-8000-0000000000bc'::uuid)$$,
  'ingreso: lote nuevo y movimiento entry, a nombre de la empleada'
);

-- Reintento.
insert into t_movement
select 'r1-retry', (r).id, (r).batch_id
from (select public.receive_stock(
  '00000000-0000-4000-8000-00000000c101', (select id from t_product where step = 'a'), 24, null, date '2030-12-31') as r) x;
select results_eq(
  $$select id, batch_id from t_movement where step = 'r1-retry'$$,
  $$select id, batch_id from t_movement where step = 'r1'$$,
  'el reintento devuelve el mismo movimiento'
);
select is(
  (select count(*)::int from public.product_batches where product_id = (select id from t_product where step = 'a')),
  1, 'el reintento no creó otro lote'
);
select throws_ok(
  $$select public.receive_stock('00000000-0000-4000-8000-00000000c101', (select id from t_product where step = 'a'), 25,
      null, date '2030-12-31')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otra cantidad → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.receive_stock('00000000-0000-4000-8000-00000000c101', (select id from t_product where step = 'c'), 24,
      null, date '2030-12-31')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otro producto → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.receive_stock('00000000-0000-4000-8000-00000000c00b', (select id from t_product where step = 'b'), 12.255,
      null, date '2031-03-31')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la clave de un alta de producto no sirve para un ingreso'
);

-- Validaciones.
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), '00000000-0000-4000-8000-00000000dead', 5, null, date '2030-12-31')$$,
  'P0001', 'PRODUCT_NOT_FOUND', 'producto inexistente → PRODUCT_NOT_FOUND'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'd'), 5, null, date '2030-12-31')$$,
  'P0001', 'PRODUCT_INACTIVE', 'ingreso a un producto inactivo → PRODUCT_INACTIVE'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'a'), 5)$$,
  'P0001', 'EXPIRY_REQUIRED', 'ingreso sin vencimiento → EXPIRY_REQUIRED'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'a'), 5, private.today_ar() + 1, date '2030-12-31')$$,
  'P0001', 'INVALID_DATE', 'fecha de ingreso futura → INVALID_DATE'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'a'), 0, null, date '2030-12-31')$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad cero → INVALID_QUANTITY'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'a'), -4, null, date '2030-12-31')$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad negativa → INVALID_QUANTITY'
);
select throws_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'a'), 2.5, null, date '2030-12-31')$$,
  'P0001', 'INVALID_QUANTITY', 'decimales en producto por unidad → INVALID_QUANTITY'
);
select throws_ok(
  $$select public.receive_stock(null, (select id from t_product where step = 'a'), 5, null, date '2030-12-31')$$,
  '23502', null, 'sin clave de idempotencia → 23502'
);
select lives_ok(
  $$select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'b'), 0.75, private.today_ar() - 6, date '2031-06-30')$$,
  'ingreso con decimales en producto por kilo y fecha de hace 6 días'
);
-- Mercadería que ya llegó vencida: se acepta y queda marcada como vencida.
insert into t_movement
select 'r-vencido', (r).id, (r).batch_id
from (select public.receive_stock(gen_random_uuid(), (select id from t_product where step = 'a'), 3, null, private.today_ar() - 1) as r) x;
select is(
  (select expiry_status::text from public.v_batch_status where id = (select batch_id from t_movement where step = 'r-vencido')),
  'expired', 'un lote ingresado con fecha pasada queda vencido'
);

select results_eq(
  $$select stock_quantity, active_batches_count from public.v_product_stock
    where product_id = (select id from t_product where step = 'a')$$,
  $$values (27.000::numeric(12,3), 2)$$,
  'el stock del producto suma los ingresos'
);
reset role;

-- ---------------------------------------------------------------------------
-- Integridad
-- ---------------------------------------------------------------------------
set constraints all immediate;
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0, 'conciliación: todos los lotes coinciden con el ledger'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'products' and action = 'insert' and changed_by = '00000000-0000-4000-8000-0000000000bb'
      and record_id in (select id from t_product)),
  4, 'las altas del encargado quedaron auditadas'
);

select * from finish();
rollback;
