-- v0.4 paso G (2 de 2): register_stock_movement, register_product_movement y
-- reverse_stock_movement. Contrato v0.4.x §8.2, §8.3, §8.5, §8.6, §8.7, §9 y §12.
-- Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Endurecimiento y firmas
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('register_stock_movement', 'register_product_movement', 'reverse_stock_movement')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'las tres RPC son SECURITY DEFINER con search_path vacío'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('register_stock_movement', 'register_product_movement', 'reverse_stock_movement')
      and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'EXECUTE solo para authenticated'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_product_movement'),
  'p_idempotency_key uuid, p_product_id uuid, p_movement_type movement_type, p_quantity numeric, p_reason text, '
  || 'p_notes text, p_occurred_at timestamp with time zone',
  'register_product_movement tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_stock_movement'),
  'p_idempotency_key uuid, p_batch_id uuid, p_movement_type movement_type, p_quantity numeric, p_reason text, '
  || 'p_notes text, p_occurred_at timestamp with time zone',
  'register_stock_movement tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'reverse_stock_movement'),
  'p_idempotency_key uuid, p_movement_id uuid, p_reason text',
  'reverse_stock_movement tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_result(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_product_movement'),
  'SETOF stock_movements', 'register_product_movement devuelve setof stock_movements'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ca', 'mora.encargada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cb', 'saul.empleado@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cc', 'ines.inactiva@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000ca';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000cc';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000d0c1', 'Categoría Mov');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000d0b1', 'Marca Mov');

create temporary table t_ids (step text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- Encargada: productos y lotes.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ca", "role": "authenticated"}', true);
set local role authenticated;

insert into t_ids
select 'p', (public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000e001', p_name => 'Leche Mov 1 L',
  p_category_id => '00000000-0000-4000-8000-00000000d0c1', p_brand_id => '00000000-0000-4000-8000-00000000d0b1',
  p_sale_unit => 'unit', p_cost_price => 100, p_sale_price => 150, p_vat_rate => 21)).id;
insert into t_ids
select 'kg', (public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000e002', p_name => 'Queso Mov',
  p_category_id => '00000000-0000-4000-8000-00000000d0c1', p_brand_id => '00000000-0000-4000-8000-00000000d0b1',
  p_sale_unit => 'kg', p_cost_price => 100, p_sale_price => 150, p_vat_rate => 21)).id;
insert into t_ids
select 'empty', (public.create_product(
  p_idempotency_key => '00000000-0000-4000-8000-00000000e003', p_name => 'Sin lotes Mov',
  p_category_id => '00000000-0000-4000-8000-00000000d0c1', p_brand_id => '00000000-0000-4000-8000-00000000d0b1',
  p_sale_unit => 'unit', p_cost_price => 100, p_sale_price => 150, p_vat_rate => 21)).id;

-- Lotes de "p": vencido (5), vence pronto (10), vence tarde (20).
insert into t_ids
select 'b_expired', (public.receive_stock('00000000-0000-4000-8000-00000000e011', (select id from t_ids where step = 'p'),
  5, (now() at time zone 'America/Argentina/Buenos_Aires')::date - 30,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date - 2)).batch_id;
insert into t_ids
select 'b_soon', (public.receive_stock('00000000-0000-4000-8000-00000000e012', (select id from t_ids where step = 'p'),
  10, null, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 10)).batch_id;
insert into t_ids
select 'b_late', (public.receive_stock('00000000-0000-4000-8000-00000000e013', (select id from t_ids where step = 'p'),
  20, null, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 100)).batch_id;
insert into t_ids
select 'b_kg', (public.receive_stock('00000000-0000-4000-8000-00000000e014', (select id from t_ids where step = 'kg'),
  2.5, null, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 10)).batch_id;
reset role;

create function pg_temp.available(p_step text) returns numeric language sql as $$
  select b.quantity_available from public.product_batches b where b.id = (select id from t_ids where step = p_step)
$$;
create function pg_temp.pid(p_step text) returns uuid language sql as $$
  select id from t_ids where step = p_step
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'internal_use', 1, 'x')$$,
  'P0001', 'NOT_AUTHORIZED', 'sin sesión → NOT_AUTHORIZED'
);

set local role anon;
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), gen_random_uuid(), 'internal_use', 1, 'x')$$,
  '42501', null, 'anon no ejecuta register_product_movement'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), gen_random_uuid(), 'x')$$,
  '42501', null, 'anon no ejecuta reverse_stock_movement'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), gen_random_uuid(), 'exit', 1)$$,
  '42501', null, 'anon no ejecuta register_stock_movement'
);
reset role;

-- Empleado: solo internal_use.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'shrinkage', 1, 'roto')$$,
  'P0001', 'NOT_AUTHORIZED', 'el empleado no registra mermas'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', 1)$$,
  'P0001', 'NOT_AUTHORIZED', 'el empleado no registra salidas'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_soon'), 'adjustment_out', 1, 'recuento')$$,
  'P0001', 'NOT_AUTHORIZED', 'el empleado no usa register_stock_movement'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'internal_use', 1)$$,
  'P0001', 'REASON_REQUIRED', 'consumo interno sin motivo → REASON_REQUIRED'
);
insert into t_ids
select 'm_staff', m.id
from public.register_product_movement('00000000-0000-4000-8000-00000000e021', pg_temp.pid('p'), 'internal_use', 2,
  'Degustación') m;
select is(
  (select created_by from public.stock_movements where id = pg_temp.pid('m_staff')),
  '00000000-0000-4000-8000-0000000000cb'::uuid, 'el consumo interno queda a nombre del empleado'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), pg_temp.pid('m_staff'), 'error')$$,
  'P0001', 'NOT_AUTHORIZED', 'el empleado no anula movimientos'
);
reset role;
select is(pg_temp.available('b_expired'), 5.000, 'consumo interno saltea el lote vencido');
select is(pg_temp.available('b_soon'), 8.000, 'consumo interno descuenta del lote que vence primero (FEFO)');

-- Usuario inactivo.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cc", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'internal_use', 1, 'x')$$,
  'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo no registra movimientos'
);
reset role;

-- ---------------------------------------------------------------------------
-- register_product_movement como encargada
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ca", "role": "authenticated"}', true);
set local role authenticated;

-- Validaciones.
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', 0)$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad cero → INVALID_QUANTITY'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', -3)$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad negativa → INVALID_QUANTITY'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', 1.5)$$,
  'P0001', 'INVALID_QUANTITY', 'decimales en unidad entera → INVALID_QUANTITY'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'entry', 1)$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'entry no se acepta (usar receive_stock)'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), gen_random_uuid(), 'exit', 1)$$,
  'P0001', 'PRODUCT_NOT_FOUND', 'producto inexistente → PRODUCT_NOT_FOUND'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'shrinkage', 1)$$,
  'P0001', 'REASON_REQUIRED', 'merma sin motivo → REASON_REQUIRED'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', 1, null, null,
      now() + interval '1 hour')$$,
  'P0001', 'INVALID_DATE', 'fecha futura → INVALID_DATE'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', 1, null, null,
      now() - interval '8 days')$$,
  'P0001', 'INVALID_DATE', 'más de 7 días de atraso → INVALID_DATE'
);
select lives_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e030', pg_temp.pid('p'), 'exit', 1,
      null, null, now() - interval '6 days')$$,
  '6 días de atraso se acepta'
);
select is(
  (select count(*)::int from public.register_product_movement(gen_random_uuid(), pg_temp.pid('kg'), 'exit', 0.125)),
  1, 'kg admite 3 decimales'
);
select is(pg_temp.available('b_kg'), 2.375, 'el lote en kg queda con 2,375');
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('empty'), 'exit', 1)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'salida de un producto sin lotes → INSUFFICIENT_STOCK'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('empty'), 'customer_return', 1, 'cliente')$$,
  'P0001', 'BATCH_NOT_FOUND', 'entrada a un producto sin lotes → BATCH_NOT_FOUND'
);

-- Estado: vencido 5, pronto 7, tarde 20. Utilizable para una salida: 27.
select is(pg_temp.available('b_soon'), 7.000, 'antes de la salida grande, el lote próximo tiene 7');
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'exit', 28)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'lo vencido no cuenta para una salida: 28 > 27 → INSUFFICIENT_STOCK'
);
select is(pg_temp.available('b_soon') + pg_temp.available('b_late'), 27.000, 'el error no registró nada');

-- Salida que cruza dos lotes: un movimiento por lote, misma operation_key.
create temporary table t_split on commit drop as
select * from public.register_product_movement('00000000-0000-4000-8000-00000000e040', pg_temp.pid('p'), 'exit', 10,
  null, 'Prueba FEFO');
select is((select count(*)::int from t_split), 2, 'la salida de 10 generó dos movimientos');
select is(
  (select count(*)::int from t_split where operation_key = '00000000-0000-4000-8000-00000000e040'), 2,
  'los dos comparten operation_key'
);
select is(
  (select count(distinct idempotency_key)::int from t_split), 2, 'cada movimiento tiene su propio idempotency_key'
);
select is(pg_temp.available('b_soon'), 0.000, 'primero vació el lote que vence antes');
select is(pg_temp.available('b_late'), 17.000, 'y completó con el siguiente');
select is(pg_temp.available('b_expired'), 5.000, 'el lote vencido no se tocó');

-- Reintento: misma clave y mismos datos devuelve lo mismo sin duplicar.
select is(
  (select count(*)::int from public.register_product_movement('00000000-0000-4000-8000-00000000e040', pg_temp.pid('p'),
    'exit', 10, null, 'Prueba FEFO')),
  2, 'el reintento devuelve los dos movimientos'
);
select is(
  (select count(*)::int from public.stock_movements where operation_key = '00000000-0000-4000-8000-00000000e040'),
  2, 'el reintento no duplicó'
);
select is(pg_temp.available('b_late'), 17.000, 'el reintento no descontó de nuevo');
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e040', pg_temp.pid('p'), 'exit', 9)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otra cantidad → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e040', pg_temp.pid('p'), 'damage', 10,
      'roto')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otro tipo → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e012', pg_temp.pid('p'), 'exit', 1)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'clave ya usada por un ingreso → IDEMPOTENCY_CONFLICT'
);

-- Merma: usa primero el lote vencido.
select is(
  (select count(*)::int from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'shrinkage', 6,
    'Vencidos descartados')),
  2, 'merma de 6: vencido (5) + siguiente (1)'
);
select is(pg_temp.available('b_expired'), 0.000, 'la merma vació el lote vencido');
select is(pg_temp.available('b_late'), 16.000, 'y siguió por el próximo con stock');

-- Entrada por producto: al lote con stock que vence más tarde.
select is(
  (select batch_id from public.register_product_movement(gen_random_uuid(), pg_temp.pid('p'), 'customer_return', 3,
    'Devolución de cliente')),
  pg_temp.pid('b_late'), 'la devolución de cliente va al lote que vence más tarde'
);
select is(pg_temp.available('b_late'), 19.000, 'el lote sumó 3');

-- ---------------------------------------------------------------------------
-- register_stock_movement (lote elegido)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_late'), 'entry', 1)$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'entry por lote → INVALID_MOVEMENT_TYPE'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), gen_random_uuid(), 'exit', 1)$$,
  'P0001', 'BATCH_NOT_FOUND', 'lote inexistente → BATCH_NOT_FOUND'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_late'), 'exit', 100)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'salida mayor al saldo del lote → INSUFFICIENT_STOCK'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_soon'), 'exit', 1)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'lote agotado → INSUFFICIENT_STOCK'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_late'), 'adjustment_out', 1)$$,
  'P0001', 'REASON_REQUIRED', 'ajuste sin motivo → REASON_REQUIRED'
);
-- Lote vencido: un ajuste positivo lo deja con 2; una salida común falla, una merma no.
select lives_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_expired'), 'adjustment_in', 2, 'Recuento')$$,
  'se puede ajustar en positivo un lote vencido'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_expired'), 'exit', 1)$$,
  'P0001', 'BATCH_EXPIRED', 'salida común de un lote vencido → BATCH_EXPIRED'
);
select lives_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.pid('b_expired'), 'damage', 1, 'Roto')$$,
  'daño sobre un lote vencido se acepta'
);
insert into t_ids
select 'm_adj', (public.register_stock_movement('00000000-0000-4000-8000-00000000e050', pg_temp.pid('b_late'),
  'adjustment_out', 4, 'Recuento')).id;
select is(pg_temp.available('b_late'), 15.000, 'el ajuste negativo descontó 4');
select is(
  (public.register_stock_movement('00000000-0000-4000-8000-00000000e050', pg_temp.pid('b_late'), 'adjustment_out', 4,
    'Recuento')).id,
  pg_temp.pid('m_adj'), 'reintento de register_stock_movement devuelve el mismo movimiento'
);
select is(pg_temp.available('b_late'), 15.000, 'y no descuenta de nuevo');
select throws_ok(
  $$select public.register_stock_movement('00000000-0000-4000-8000-00000000e050', pg_temp.pid('b_late'), 'adjustment_out',
      5, 'Recuento')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otra cantidad → IDEMPOTENCY_CONFLICT'
);

-- ---------------------------------------------------------------------------
-- reverse_stock_movement
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), pg_temp.pid('m_adj'), '  ')$$,
  'P0001', 'REASON_REQUIRED', 'anular sin motivo → REASON_REQUIRED'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), gen_random_uuid(), 'x')$$,
  'P0001', 'MOVEMENT_NOT_FOUND', 'movimiento inexistente → MOVEMENT_NOT_FOUND'
);
insert into t_ids
select 'r_adj', (public.reverse_stock_movement('00000000-0000-4000-8000-00000000e060', pg_temp.pid('m_adj'),
  'Recuento mal hecho')).id;
select is(pg_temp.available('b_late'), 19.000, 'anular el ajuste negativo devuelve las 4 unidades');
select is(
  (select movement_type::text || ':' || quantity::text || ':' || reverses_movement_id::text
     from public.stock_movements where id = pg_temp.pid('r_adj')),
  'adjustment_in:4.000:' || pg_temp.pid('m_adj')::text, 'la anulación es adjustment_in por 4 que apunta al original'
);
select is(
  (public.reverse_stock_movement('00000000-0000-4000-8000-00000000e060', pg_temp.pid('m_adj'), 'Recuento mal hecho')).id,
  pg_temp.pid('r_adj'), 'reintento de la anulación devuelve la misma'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), pg_temp.pid('m_adj'), 'otra vez')$$,
  'P0001', 'ALREADY_REVERSED', 'anular dos veces → ALREADY_REVERSED'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), pg_temp.pid('r_adj'), 'x')$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'anular una anulación → INVALID_MOVEMENT_TYPE'
);
select throws_ok(
  $$select public.reverse_stock_movement('00000000-0000-4000-8000-00000000e060', pg_temp.pid('m_staff'), 'x')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave para otro movimiento → IDEMPOTENCY_CONFLICT'
);
-- Anular un ingreso del lote "pronto" (agotado): no puede dejarlo negativo.
select throws_ok(
  format($$select public.reverse_stock_movement(gen_random_uuid(), %L, 'ingreso duplicado')$$,
    (select id from public.stock_movements where idempotency_key = '00000000-0000-4000-8000-00000000e012')),
  'P0001', 'INSUFFICIENT_STOCK', 'anular un ingreso ya consumido → INSUFFICIENT_STOCK'
);
-- Anular el consumo interno del empleado devuelve la unidad al mismo lote.
select lives_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), pg_temp.pid('m_staff'), 'No era consumo')$$,
  'la encargada anula el consumo interno'
);
select is(pg_temp.available('b_soon'), 2.000, 'el consumo anulado vuelve a su lote');

-- La reversión no aplica PRODUCT_INACTIVE.
reset role;
update public.products set is_active = false where id = pg_temp.pid('kg');
set local role authenticated;
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('kg'), 'exit', 0.5)$$,
  'P0001', 'PRODUCT_INACTIVE', 'salida de un producto inactivo → PRODUCT_INACTIVE'
);
select lives_ok(
  format($$select public.reverse_stock_movement(gen_random_uuid(), %L, 'carga errónea')$$,
    (select id from public.stock_movements where product_id = pg_temp.pid('kg') and movement_type = 'exit')),
  'se puede anular un movimiento de un producto inactivo'
);
select is(pg_temp.available('b_kg'), 2.500, 'la anulación devolvió los 0,125 kg');
reset role;

-- ---------------------------------------------------------------------------
-- Integridad: cada lote coincide con su ledger
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.product_batches b
    where b.product_id in (pg_temp.pid('p'), pg_temp.pid('kg'))
      and b.quantity_available <> (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m
                                   where m.batch_id = b.id)),
  0, 'todos los lotes coinciden con la suma de sus movimientos'
);
select is(
  (select count(*)::int from public.stock_movements m
    join public.product_batches b on b.id = m.batch_id
    where b.product_id = pg_temp.pid('p') and m.batch_quantity_after < 0),
  0, 'ningún movimiento dejó saldo negativo'
);

select * from finish();
rollback;
