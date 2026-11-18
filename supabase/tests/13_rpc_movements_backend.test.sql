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
      and p.proname not like 'fiscal_%'
      and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'todas las funciones de public: EXECUTE solo para authenticated'
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
  (select proretset from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'register_product_movement'),
  true, 'register_product_movement devuelve setof'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios, creados con las RPC
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ca', 'dora.duena@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cb', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cc', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cd', 'ivan.inactivo@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000ca';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000cb';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000cd';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000d0c1', 'Categoría movimientos');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000d0b1', 'Marca movimientos');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_m (step text, id uuid, batch_id uuid, quantity numeric, batch_quantity_after numeric) on commit drop;
grant all on t_p, t_m to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;

-- PA: dos lotes vigentes. A vence antes (4 u.), B después (20 u.).
insert into t_p select 'PA', (public.create_product(gen_random_uuid(), 'Mov PA fideos', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 100, 150, 21)).id;
select public.receive_stock(gen_random_uuid(), (select id from t_p where code = 'PA'), 4, null, private.today_ar() + 10);
select public.receive_stock(gen_random_uuid(), (select id from t_p where code = 'PA'), 20, null, private.today_ar() + 60);

-- PB: un lote vencido (5 u.) y uno vigente (10 u.).
insert into t_p select 'PB', (public.create_product(gen_random_uuid(), 'Mov PB yogur', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 100, 150, 21)).id;
select public.receive_stock(gen_random_uuid(), (select id from t_p where code = 'PB'), 5, null, private.today_ar() - 2);
select public.receive_stock(gen_random_uuid(), (select id from t_p where code = 'PB'), 10, null, private.today_ar() + 30);

-- PC: por kilo.
insert into t_p select 'PC', (public.create_product(gen_random_uuid(), 'Mov PC jamón', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'kg', 5000, 8000, 10.5,
  p_initial_quantity => 2.5, p_expires_on => private.today_ar() + 20)).id;

-- PD: sin lotes.
insert into t_p select 'PD', (public.create_product(gen_random_uuid(), 'Mov PD sin lotes', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 1, 2, 21)).id;

-- PE: con un lote; después se desactiva.
insert into t_p select 'PE', (public.create_product(gen_random_uuid(), 'Mov PE discontinuado', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 1, 2, 21,
  p_initial_quantity => 8, p_expires_on => private.today_ar() + 40)).id;
update public.products set is_active = false where id = (select id from t_p where code = 'PE');
reset role;

create function pg_temp.batch_of(p_code text, p_days integer) returns uuid language sql as $$
  select b.id from public.product_batches b
  where b.product_id = (select id from t_p where code = p_code) and b.expires_on = private.today_ar() + p_days;
$$;
create function pg_temp.stock_of(p_code text) returns numeric language sql as $$
  select coalesce(sum(b.quantity_available), 0) from public.product_batches b
  where b.product_id = (select id from t_p where code = p_code);
$$;
grant execute on function pg_temp.batch_of(text, integer), pg_temp.stock_of(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.register_product_movement(gen_random_uuid(), gen_random_uuid(), 'exit', 1)$$, '42501', null, 'anon no ejecuta register_product_movement');
select throws_ok($$select public.register_stock_movement(gen_random_uuid(), gen_random_uuid(), 'exit', 1)$$, '42501', null, 'anon no ejecuta register_stock_movement');
select throws_ok($$select public.reverse_stock_movement(gen_random_uuid(), gen_random_uuid(), 'x')$$, '42501', null, 'anon no ejecuta reverse_stock_movement');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cd", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'internal_use', 1, 'Prueba')$$,
  'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo no registra movimientos'
);
reset role;

-- Empleada: solo consumo interno.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cc", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 1)$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no registra salidas genéricas'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'shrinkage', 1, 'Rotura')$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no registra mermas'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'adjustment_in', 1, 'Recuento')$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no registra ajustes'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PA', 10), 'internal_use', 1, 'Prueba')$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no usa register_stock_movement'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), gen_random_uuid(), 'Error de carga')$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no anula movimientos'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PC'), 'internal_use', 0.1)$$,
  'P0001', 'REASON_REQUIRED', 'consumo interno sin motivo → REASON_REQUIRED'
);
insert into t_m
select 'staff-iu', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PC'), 'internal_use', 0.250, 'Degustación');
reset role;

select results_eq(
  $$select m.movement_type::text, m.quantity, m.batch_quantity_after, m.created_by, m.reason
    from public.stock_movements m where m.id = (select id from t_m where step = 'staff-iu')$$,
  $$values ('internal_use', 0.250::numeric(12,3), 2.250::numeric(12,3), '00000000-0000-4000-8000-0000000000cc'::uuid, 'Degustación')$$,
  'la empleada registra consumo interno (con decimales en un producto por kilo)'
);

-- ---------------------------------------------------------------------------
-- register_product_movement como encargado
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;

-- Salida de 10 con lotes A (4) y B (20): 4 de A y 6 de B.
insert into t_m
select 'exit10', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement('00000000-0000-4000-8000-00000000e010', (select id from t_p where code = 'PA'), 'exit', 10);

select results_eq(
  $$select t.batch_id, t.quantity, t.batch_quantity_after from t_m t where t.step = 'exit10' order by t.batch_quantity_after$$,
  $$values (pg_temp.batch_of('PA', 10), 4.000::numeric, 0.000::numeric), (pg_temp.batch_of('PA', 60), 6.000::numeric, 14.000::numeric)$$,
  'salida de 10: 4 del lote que vence primero y 6 del siguiente'
);
select results_eq(
  $$select count(*)::int, count(distinct idempotency_key)::int, count(distinct operation_key)::int, min(operation_key::text)
    from public.stock_movements where id in (select id from t_m where step = 'exit10')$$,
  $$values (2, 2, 1, '00000000-0000-4000-8000-00000000e010')$$,
  'un movimiento por lote, cada uno con su idempotency_key y la misma operation_key'
);
select is(pg_temp.stock_of('PA'), 14.000::numeric, 'el stock bajó de 24 a 14');

-- Reintento con la misma clave: los mismos movimientos, sin duplicar.
insert into t_m
select 'exit10-retry', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement('00000000-0000-4000-8000-00000000e010', (select id from t_p where code = 'PA'), 'exit', 10);
select set_eq(
  $$select id from t_m where step = 'exit10-retry'$$,
  $$select id from t_m where step = 'exit10'$$,
  'el reintento devuelve los mismos movimientos'
);
select is(pg_temp.stock_of('PA'), 14.000::numeric, 'el reintento no volvió a descontar');
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e010', (select id from t_p where code = 'PA'), 'exit', 11)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otra cantidad → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e010', (select id from t_p where code = 'PA'), 'damage', 10, 'Rotura')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otro tipo → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e010', (select id from t_p where code = 'PB'), 'exit', 10)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otro producto → IDEMPOTENCY_CONFLICT'
);

-- Salida mayor al stock: no se registra nada.
select throws_ok(
  $$select * from public.register_product_movement('00000000-0000-4000-8000-00000000e030', (select id from t_p where code = 'PA'), 'exit', 30)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'salida de 30 con 14 en stock → INSUFFICIENT_STOCK'
);
select is(pg_temp.stock_of('PA'), 14.000::numeric, 'la salida rechazada no cambió el stock');
select is(
  (select count(*)::int from public.stock_movements where operation_key = '00000000-0000-4000-8000-00000000e030'),
  0, 'la salida rechazada no dejó movimientos'
);

-- Lotes vencidos (PB: vencido 5, vigente 10).
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PB'), 'exit', 12)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'salida de 12: el lote vencido no cuenta, solo hay 10 utilizables'
);
insert into t_m
select 'iu3', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PB'), 'internal_use', 3, 'Consumo del personal');
select results_eq(
  $$select batch_id, quantity, batch_quantity_after from t_m where step = 'iu3'$$,
  $$values (pg_temp.batch_of('PB', 30), 3.000::numeric, 7.000::numeric)$$,
  'consumo interno: saltea el lote vencido y usa el vigente'
);
insert into t_m
select 'shr6', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PB'), 'shrinkage', 6, 'Vencidos descartados');
select results_eq(
  $$select batch_id, quantity, batch_quantity_after from t_m where step = 'shr6' order by batch_quantity_after$$,
  $$values (pg_temp.batch_of('PB', -2), 5.000::numeric, 0.000::numeric), (pg_temp.batch_of('PB', 30), 1.000::numeric, 6.000::numeric)$$,
  'merma: usa primero el lote vencido y sigue con el vigente'
);

-- Validaciones.
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'entry', 5)$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'entry no se acepta: los ingresos van por receive_stock'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), '00000000-0000-4000-8000-00000000dead', 'exit', 5)$$,
  'P0001', 'PRODUCT_NOT_FOUND', 'producto inexistente → PRODUCT_NOT_FOUND'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 0)$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad cero → INVALID_QUANTITY'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', -2)$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad negativa → INVALID_QUANTITY'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 1.5)$$,
  'P0001', 'INVALID_QUANTITY', 'decimales en un producto por unidad → INVALID_QUANTITY'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'shrinkage', 1)$$,
  'P0001', 'REASON_REQUIRED', 'merma sin motivo → REASON_REQUIRED'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'damage', 1, '   ')$$,
  'P0001', 'REASON_REQUIRED', 'motivo en blanco → REASON_REQUIRED'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 1, null, null, now() + interval '1 hour')$$,
  'P0001', 'INVALID_DATE', 'fecha futura → INVALID_DATE'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 1, null, null, now() - interval '8 days')$$,
  'P0001', 'INVALID_DATE', 'más de 7 días de atraso → INVALID_DATE'
);
insert into t_m
select 'late3', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 1, null, 'Cargada tarde', now() - interval '3 days');
select is(
  (select (now() - occurred_at) between interval '2 days 23 hours' and interval '3 days 1 hour'
    from public.stock_movements where id = (select id from t_m where step = 'late3')),
  true, 'con 3 días de atraso se acepta y guarda la fecha enviada'
);
select lives_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'exit', 1, null, null, now() + interval '2 minutes')$$,
  'una diferencia de reloj de 2 minutos hacia adelante se tolera'
);

-- Producto inactivo (P-13): solo merma, daño o devolución a proveedor.
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PE'), 'exit', 1)$$,
  'P0001', 'PRODUCT_INACTIVE', 'salida de un producto inactivo → PRODUCT_INACTIVE'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PE'), 'internal_use', 1, 'Consumo')$$,
  'P0001', 'PRODUCT_INACTIVE', 'consumo interno de un producto inactivo → PRODUCT_INACTIVE'
);
select lives_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PE'), 'supplier_return', 2, 'Devolución al proveedor')$$,
  'devolución a proveedor de un producto inactivo: permitida'
);

-- Entradas por producto.
insert into t_m
select 'adjin', id, batch_id, quantity, batch_quantity_after
from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PB'), 'adjustment_in', 4, 'Recuento');
select results_eq(
  $$select batch_id, batch_quantity_after from t_m where step = 'adjin'$$,
  $$values (pg_temp.batch_of('PB', 30), 10.000::numeric)$$,
  'ajuste positivo: va al lote con stock que vence más tarde'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PD'), 'customer_return', 1, 'Devolución')$$,
  'P0001', 'BATCH_NOT_FOUND', 'entrada a un producto sin lotes → BATCH_NOT_FOUND'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PD'), 'exit', 1)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'salida de un producto sin lotes → INSUFFICIENT_STOCK'
);

-- ---------------------------------------------------------------------------
-- register_stock_movement (lote elegido)
-- ---------------------------------------------------------------------------
insert into t_m
select 'rsm', (r).id, (r).batch_id, (r).quantity, (r).batch_quantity_after
from (select public.register_stock_movement('00000000-0000-4000-8000-00000000e100', pg_temp.batch_of('PA', 60), 'adjustment_out', 2, 'Recuento del lote') as r) x;
select results_eq(
  $$select m.batch_id, m.movement_type::text, m.batch_quantity_after, m.operation_key is null, m.product_id
    from public.stock_movements m where m.id = (select id from t_m where step = 'rsm')$$,
  $$values (pg_temp.batch_of('PA', 60), 'adjustment_out', 10.000::numeric(12,3), true, (select id from t_p where code = 'PA'))$$,
  'ajuste sobre un lote concreto; el producto se toma del lote'
);
select is(
  (select (public.register_stock_movement('00000000-0000-4000-8000-00000000e100', pg_temp.batch_of('PA', 60), 'adjustment_out', 2, 'Recuento del lote')).id),
  (select id from t_m where step = 'rsm'),
  'reintento: devuelve el mismo movimiento'
);
select throws_ok(
  $$select public.register_stock_movement('00000000-0000-4000-8000-00000000e100', pg_temp.batch_of('PA', 60), 'adjustment_out', 3, 'Recuento del lote')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otra cantidad → IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.register_stock_movement('00000000-0000-4000-8000-00000000e010', pg_temp.batch_of('PA', 60), 'adjustment_out', 1, 'Recuento')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la clave de una operación por producto no sirve para otra RPC'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PA', 60), 'entry', 5)$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'entry por register_stock_movement → INVALID_MOVEMENT_TYPE'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), '00000000-0000-4000-8000-00000000dead', 'exit', 1)$$,
  'P0001', 'BATCH_NOT_FOUND', 'lote inexistente → BATCH_NOT_FOUND'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PA', 60), 'exit', 500)$$,
  'P0001', 'INSUFFICIENT_STOCK', 'salida mayor al saldo del lote → INSUFFICIENT_STOCK'
);
select is(
  (select quantity_available from public.product_batches where id = pg_temp.batch_of('PA', 60)),
  10.000::numeric(12,3), 'el saldo del lote no cambió con la salida rechazada'
);
-- Lote vencido (PB vencido quedó en 0: se le devuelve stock con un ajuste positivo, que sí se permite).
select lives_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PB', -2), 'adjustment_in', 3, 'Aparecieron 3 unidades')$$,
  'ajuste positivo sobre un lote vencido: permitido'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PB', -2), 'exit', 1)$$,
  'P0001', 'BATCH_EXPIRED', 'exit sobre un lote vencido → BATCH_EXPIRED'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PB', -2), 'internal_use', 1, 'Consumo')$$,
  'P0001', 'BATCH_EXPIRED', 'consumo interno sobre un lote vencido → BATCH_EXPIRED'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PB', -2), 'adjustment_out', 1, 'Recuento')$$,
  'P0001', 'BATCH_EXPIRED', 'ajuste negativo sobre un lote vencido → BATCH_EXPIRED'
);
select lives_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PB', -2), 'shrinkage', 1, 'Vencido')$$,
  'shrinkage sobre el mismo lote vencido: permitido'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), pg_temp.batch_of('PE', 40), 'exit', 1)$$,
  'P0001', 'PRODUCT_INACTIVE', 'exit sobre el lote de un producto inactivo → PRODUCT_INACTIVE'
);

-- ---------------------------------------------------------------------------
-- reverse_stock_movement
-- ---------------------------------------------------------------------------
-- Se anula la parte de la salida de 10 que salió del lote B (6 u.).
insert into t_m
select 'rev', (r).id, (r).batch_id, (r).quantity, (r).batch_quantity_after
from (select public.reverse_stock_movement(
  '00000000-0000-4000-8000-00000000e200',
  (select id from t_m where step = 'exit10' and batch_id = pg_temp.batch_of('PA', 60)),
  'Salida cargada por error') as r) x;

select results_eq(
  $$select m.movement_type::text, m.quantity, m.batch_quantity_after, m.reason,
           m.reverses_movement_id = (select id from t_m where step = 'exit10' and batch_id = pg_temp.batch_of('PA', 60)),
           m.created_by
    from public.stock_movements m where m.id = (select id from t_m where step = 'rev')$$,
  $$values ('adjustment_in', 6.000::numeric(12,3), 16.000::numeric(12,3), 'Salida cargada por error', true,
            '00000000-0000-4000-8000-0000000000cb'::uuid)$$,
  'anular una salida crea un ajuste positivo con reverses_movement_id'
);
select is(
  (select (public.reverse_stock_movement('00000000-0000-4000-8000-00000000e200',
    (select id from t_m where step = 'exit10' and batch_id = pg_temp.batch_of('PA', 60)), 'Salida cargada por error')).id),
  (select id from t_m where step = 'rev'),
  'reintento de la anulación: devuelve el mismo movimiento'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(),
      (select id from t_m where step = 'exit10' and batch_id = pg_temp.batch_of('PA', 60)), 'Otra vez')$$,
  'P0001', 'ALREADY_REVERSED', 'anular dos veces → ALREADY_REVERSED'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), (select id from t_m where step = 'rev'), 'Anular la anulación')$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'anular una anulación → INVALID_MOVEMENT_TYPE'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), '00000000-0000-4000-8000-00000000dead', 'No existe')$$,
  'P0001', 'MOVEMENT_NOT_FOUND', 'movimiento inexistente → MOVEMENT_NOT_FOUND'
);
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), (select id from t_m where step = 'iu3'), '  ')$$,
  'P0001', 'REASON_REQUIRED', 'anular sin motivo → REASON_REQUIRED'
);
select throws_ok(
  $$select public.reverse_stock_movement('00000000-0000-4000-8000-00000000e200', (select id from t_m where step = 'iu3'), 'Otra')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave para anular otro movimiento → IDEMPOTENCY_CONFLICT'
);
-- Anular el ingreso de un lote vencido: permitido (no aplica BATCH_EXPIRED).
select lives_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(),
      (select m.id from public.stock_movements m where m.batch_id = pg_temp.batch_of('PB', -2) and m.movement_type = 'shrinkage'
        and m.operation_key is null),
      'La merma del vencido estaba mal')$$,
  'anular un movimiento de un lote vencido: permitido'
);
-- Anular el ingreso de un producto inactivo: permitido si el stock alcanza.
select throws_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(),
      (select m.id from public.stock_movements m where m.batch_id = pg_temp.batch_of('PE', 40) and m.movement_type = 'entry'),
      'Ingreso mal cargado')$$,
  'P0001', 'INSUFFICIENT_STOCK', 'anular un ingreso de 8 cuando quedan 6 → INSUFFICIENT_STOCK'
);
select lives_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(),
      (select m.id from public.stock_movements m where m.batch_id = pg_temp.batch_of('PE', 40) and m.movement_type = 'supplier_return'),
      'La devolución no se hizo')$$,
  'anular un movimiento de un producto inactivo: permitido'
);
select lives_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(),
      (select m.id from public.stock_movements m where m.batch_id = pg_temp.batch_of('PE', 40) and m.movement_type = 'entry'),
      'Ingreso mal cargado')$$,
  'ahora sí: anular el ingreso de un producto inactivo (adjustment_out)'
);
reset role;

select is(pg_temp.stock_of('PE'), 0.000::numeric, 'el producto inactivo quedó sin stock tras anular su ingreso');

-- La dueña también puede todo.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ca", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), (select id from t_p where code = 'PA'), 'damage', 1, 'Paquete roto')$$,
  'la dueña registra un daño'
);
select lives_ok(
  $$select public.reverse_stock_movement(gen_random_uuid(), (select id from t_m where step = 'late3'), 'No correspondía')$$,
  'la dueña anula un movimiento'
);
reset role;

-- ---------------------------------------------------------------------------
-- Integridad final
-- ---------------------------------------------------------------------------
set constraints all immediate;
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0, 'conciliación: todos los lotes coinciden con el ledger'
);
select is(
  (select count(*)::int from public.product_batches where quantity_available < 0),
  0, 'ningún lote quedó en negativo'
);
select is(
  (select count(*)::int from public.stock_movements m
    where m.product_id in (select id from t_p) and m.created_by is null),
  0, 'todos los movimientos tienen autor'
);
-- Las vistas reflejan el resultado.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select stock_quantity from public.v_product_list where id = (select id from t_p where code = 'PA')$$,
  $$select pg_temp.stock_of('PA')::numeric(12,3)$$,
  'v_product_list muestra el stock que dejaron los movimientos'
);
reset role;

select * from finish();
rollback;
