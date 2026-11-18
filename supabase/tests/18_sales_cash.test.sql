-- Etapa 5 (ventas y caja): tablas, RLS, caja, register_sale, void_sale y redondeo.
-- Contrato v0.6.3 §15 y P-30, P-33, P-34, P-36, P-40. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura, seguridad y semillas
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('payment_methods', 'cash_registers', 'sales_settings', 'cash_sessions', 'sales', 'sale_items', 'sale_payments')
      and t.rowsecurity),
  7, 'las 7 tablas nuevas tienen RLS activada'
);
select is(
  (select count(*)::int from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('payment_methods', 'cash_registers', 'sales_settings', 'cash_sessions', 'sales', 'sale_items',
                           'sale_payments', 'v_cash_session_summary', 'v_cash_session_payments')
      and g.grantee = 'anon'),
  0, 'anon no tiene ningún permiso sobre las tablas y vistas nuevas'
);
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in ('v_cash_session_summary', 'v_cash_session_payments')
     and c.reloptions @> array['security_invoker=true']),
  2, 'las dos vistas de caja usan security_invoker'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('open_cash_session', 'close_cash_session', 'register_sale', 'void_sale')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  4, 'las 4 RPC de caja y ventas son SECURITY DEFINER con search_path vacío'
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
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_sale'),
  'p_idempotency_key uuid, p_cash_session_id uuid, p_items jsonb, p_payments jsonb, p_notes text',
  'register_sale tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'open_cash_session'),
  'p_idempotency_key uuid, p_cash_register_id uuid, p_opening_amount numeric',
  'open_cash_session tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'close_cash_session'),
  'p_cash_session_id uuid, p_counted_cash numeric, p_close_notes text',
  'close_cash_session tiene los parámetros del contrato'
);
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'void_sale'),
  'p_idempotency_key uuid, p_sale_id uuid, p_reason text',
  'void_sale tiene los parámetros del contrato'
);
select is(
  (select array_agg(code order by sort_order) from public.payment_methods),
  array['cash', 'debit', 'credit', 'qr', 'transfer'], 'la migración siembra los 5 medios de pago'
);
select is((select count(*)::int from public.payment_methods where is_cash), 1, 'un solo medio es efectivo');
select is((select array_agg(name order by name) from public.cash_registers), array['Caja 1', 'Caja 2'], 'la migración siembra Caja 1 y Caja 2');
select is((select rounding_multiple from public.sales_settings), 100.00, 'el múltiplo de redondeo inicial es 100');
select is((select count(*)::int from public.sales_settings), 1, 'sales_settings tiene una sola fila');
select is(
  (select count(*)::int from pg_enum e where e.enumtypid = 'public.movement_type'::regtype and e.enumlabel = 'sale'),
  1, 'movement_type incluye sale'
);

-- Redondeo del efectivo (P-30): centena más cercana, desde la mitad sube.
select is(private.round_cash(1237, 100), 1200::numeric, 'round_cash 1.237 -> 1.200');
select is(private.round_cash(1249, 100), 1200::numeric, 'round_cash 1.249 -> 1.200');
select is(private.round_cash(1250, 100), 1300::numeric, 'round_cash 1.250 -> 1.300');
select is(private.round_cash(1280, 100), 1300::numeric, 'round_cash 1.280 -> 1.300');
select is(private.round_cash(1200, 100), 1200::numeric, 'round_cash 1.200 -> 1.200');
select is(private.round_cash(1249.99, 100), 1200::numeric, 'round_cash 1.249,99 -> 1.200 (sin errores de coma flotante)');
select is(private.round_cash(49.99, 100), 49.99::numeric, 'round_cash: menos de la mitad del múltiplo se cobra exacto (P-39)');
select is(private.round_cash(30, 100), 30::numeric, 'round_cash: $30 -> $30');
select is(private.round_cash(50, 100), 100::numeric, 'round_cash 50 -> 100');
select is(private.round_cash(0, 100), 0::numeric, 'round_cash 0 -> 0');
select is(private.round_cash(null, 100), null::numeric, 'round_cash de nulo -> nulo');
select is(private.round_cash(3525, 50), 3550::numeric, 'round_cash con múltiplo 50');
select is(private.normalize_money(0.30000000000000004), 0.30::numeric, 'normalize_money tolera ruido de coma flotante');
select is(private.normalize_money(10.005), null::numeric, 'normalize_money rechaza decimales reales de más');

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ca', 'dora.duena@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cb', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cc', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000cd', 'ivan.inactivo@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000ce', 'ema.empleada@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000ca';
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000cb';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000cd';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000d0c1', 'Categoría ventas');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000d0b1', 'Marca ventas');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_c (code text primary key, id uuid) on commit drop;
create temporary table t_s (code text primary key, id uuid) on commit drop;
-- Punto de partida: la prueba no supone tablas vacías (puede haber datos de otras corridas).
create temporary table t_base (k text primary key, n int) on commit drop;
insert into t_base values
  ('sales', (select count(*)::int from public.sales)),
  ('open', (select count(*)::int from public.cash_sessions where status = 'open'));
grant select on t_base to authenticated;
grant all on t_p, t_c, t_s to authenticated;

create function pg_temp.pid(p text) returns uuid language sql as $$ select id from t_p where code = p $$;
create function pg_temp.sid(c text) returns uuid language sql as $$ select id from t_c where code = c $$;
create function pg_temp.vid(c text) returns uuid language sql as $$ select id from t_s where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
create function pg_temp.it(p text, q numeric, d numeric default null) returns jsonb language sql as
  $$ select jsonb_build_object('product_id', pg_temp.pid(p), 'quantity', q) || case when d is null then '{}'::jsonb else jsonb_build_object('discount_percent', d) end $$;
create function pg_temp.pay(c text, a numeric, t numeric default null) returns jsonb language sql as
  $$ select jsonb_build_object('payment_method_id', pg_temp.mid(c), 'amount', a, 'tendered_amount', t) $$;
create function pg_temp.stock_of(p text) returns numeric language sql as $$
  select coalesce(sum(b.quantity_available), 0) from public.product_batches b where b.product_id = pg_temp.pid(p) $$;
create function pg_temp.lot(p text, d integer) returns numeric language sql as $$
  select b.quantity_available from public.product_batches b where b.product_id = pg_temp.pid(p) and b.expires_on = private.today_ar() + d $$;
grant execute on function pg_temp.pid(text), pg_temp.sid(text), pg_temp.vid(text), pg_temp.mid(text), pg_temp.it(text, numeric, numeric),
  pg_temp.pay(text, numeric, numeric), pg_temp.stock_of(text), pg_temp.lot(text, integer) to authenticated;

-- Catálogo creado por el encargado con las RPC.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;

-- SA: 1.210 con IVA 21 %. Lote A (4 u., vence +10) y B (20 u., +60).
insert into t_p select 'SA', (public.create_product(gen_random_uuid(), 'Venta SA fideos', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 100, 1000, 21)).id;
select public.receive_stock(gen_random_uuid(), pg_temp.pid('SA'), 4, null, private.today_ar() + 10);
select public.receive_stock(gen_random_uuid(), pg_temp.pid('SA'), 20, null, private.today_ar() + 60);
-- SB: 1.105 con IVA 10,5 %. Un lote vencido (5 u.) y uno vigente (10 u.).
insert into t_p select 'SB', (public.create_product(gen_random_uuid(), 'Venta SB yogur', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 100, 1000, 10.5)).id;
select public.receive_stock(gen_random_uuid(), pg_temp.pid('SB'), 5, null, private.today_ar() - 2);
select public.receive_stock(gen_random_uuid(), pg_temp.pid('SB'), 10, null, private.today_ar() + 30);
-- SK: por kilo, 8.840 el kg. 2,5 kg.
insert into t_p select 'SK', (public.create_product(gen_random_uuid(), 'Venta SK jamón', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'kg', 5000, 8000, 10.5,
  p_initial_quantity => 2.5, p_expires_on => private.today_ar() + 20)).id;
-- SD: inactivo con stock. SZ: precio 0. SL: precio bajo (48,40 con IVA).
insert into t_p select 'SD', (public.create_product(gen_random_uuid(), 'Venta SD discontinuado', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 1, 1000, 21,
  p_initial_quantity => 5, p_expires_on => private.today_ar() + 40)).id;
update public.products set is_active = false where id = pg_temp.pid('SD');
insert into t_p select 'SZ', (public.create_product(gen_random_uuid(), 'Venta SZ sin precio', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 1, 0, 21,
  p_initial_quantity => 5, p_expires_on => private.today_ar() + 40)).id;
insert into t_p select 'SL', (public.create_product(gen_random_uuid(), 'Venta SL caramelo', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 10, 40, 21,
  p_initial_quantity => 50, p_expires_on => private.today_ar() + 90)).id;
reset role;

select is((select sale_price_with_vat from public.products where id = pg_temp.pid('SA')), 1210.00::numeric, 'SA cuesta 1.210 con IVA');
select is(pg_temp.stock_of('SA'), 24::numeric, 'SA arranca con 24 u.');

-- ---------------------------------------------------------------------------
-- Permisos de las RPC y apertura de caja
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.open_cash_session(gen_random_uuid(), gen_random_uuid(), 0)$$, '42501', null, 'anon no ejecuta open_cash_session');
select throws_ok($$select public.register_sale(gen_random_uuid(), gen_random_uuid(), '[]', '[]')$$, '42501', null, 'anon no ejecuta register_sale');
select throws_ok($$select public.void_sale(gen_random_uuid(), gen_random_uuid(), 'x')$$, '42501', null, 'anon no ejecuta void_sale');
select throws_ok($$select public.close_cash_session(gen_random_uuid(), 0)$$, '42501', null, 'anon no ejecuta close_cash_session');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cd", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 0)$$,
  'P0001', 'NOT_AUTHORIZED', 'un usuario inactivo no abre caja'
);
reset role;

-- Eva (empleada) abre la Caja 1.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cc", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), -1)$$,
  'P0001', 'INVALID_AMOUNT', 'apertura con monto negativo -> INVALID_AMOUNT'
);
select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 10.005)$$,
  'P0001', 'INVALID_AMOUNT', 'apertura con decimales de más -> INVALID_AMOUNT'
);
select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), gen_random_uuid(), 100)$$,
  'P0001', 'CASH_REGISTER_NOT_FOUND', 'caja inexistente -> CASH_REGISTER_NOT_FOUND'
);

insert into t_c select 'S1', (public.open_cash_session('11111111-1111-4111-8111-111111111111',
  (select id from public.cash_registers where name = 'Caja 1'), 500)).id;
select is((select status::text from public.cash_sessions where id = pg_temp.sid('S1')), 'open', 'la sesión queda abierta');
select is((select opening_amount from public.cash_sessions where id = pg_temp.sid('S1')), 500.00::numeric, 'guarda el efectivo inicial');
select is((select opened_by from public.cash_sessions where id = pg_temp.sid('S1')), '00000000-0000-4000-8000-0000000000cc'::uuid, 'opened_by es quien abrió');
select is(
  (select id from public.open_cash_session('11111111-1111-4111-8111-111111111111',
     (select id from public.cash_registers where name = 'Caja 1'), 500)),
  pg_temp.sid('S1'), 'reintento con la misma clave devuelve la misma sesión'
);
select throws_ok(
  $$select public.open_cash_session('11111111-1111-4111-8111-111111111111', (select id from public.cash_registers where name = 'Caja 1'), 999)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otro monto -> IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 100)$$,
  'P0001', 'CASH_SESSION_ALREADY_OPEN', 'una caja no tiene dos sesiones abiertas'
);
reset role;

-- El encargado abre la Caja 2 (dos cajas a la vez) y prepara un medio de pago y una caja inactiva.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;
insert into t_c select 'S2', (public.open_cash_session(gen_random_uuid(),
  (select id from public.cash_registers where name = 'Caja 2'), 100)).id;
select is((select count(*)::int from public.cash_sessions where status = 'open'), (select n + 2 from t_base where k = 'open'), 'dos cajas abiertas a la vez');
insert into public.cash_registers (name, is_active) values ('Caja vieja', false);
select throws_ok(
  $$select public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja vieja'), 0)$$,
  'P0001', 'CASH_REGISTER_NOT_FOUND', 'una caja inactiva no se abre'
);
reset role;

-- ---------------------------------------------------------------------------
-- Ventas de Eva en la sesión S1
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cc", "role": "authenticated"}', true);
set local role authenticated;

-- Venta 1: SA x2 + SB x1 = 3.525; el efectivo se redondea a 3.500 (-25).
insert into t_s select 'V1', (public.register_sale('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('SA', 2), pg_temp.it('SB', 1)),
  jsonb_build_array(pg_temp.pay('cash', 3500, 4000)))).id;
select is((select total_amount from public.sales where id = pg_temp.vid('V1')), 3525.00::numeric, 'V1: total de los ítems');
select is((select net_amount from public.sales where id = pg_temp.vid('V1')), 3000.00::numeric, 'V1: neto sin IVA');
select is((select vat_amount from public.sales where id = pg_temp.vid('V1')), 525.00::numeric, 'V1: IVA');
select is((select rounding_amount from public.sales where id = pg_temp.vid('V1')), -25.00::numeric, 'V1: el redondeo es -25 (cobró 3.500 por 3.525)');
select is((select status::text from public.sales where id = pg_temp.vid('V1')), 'completed', 'V1: estado completed');
select is((select created_by from public.sales where id = pg_temp.vid('V1')), '00000000-0000-4000-8000-0000000000cc'::uuid, 'V1: created_by es quien vendió');
select is((select count(*)::int from public.sale_items where sale_id = pg_temp.vid('V1')), 2, 'V1: dos ítems');
select is(
  (select unit_price_with_vat from public.sale_items where sale_id = pg_temp.vid('V1') and product_id = pg_temp.pid('SA')),
  1210.00::numeric, 'V1: el ítem copia el precio con IVA'
);
select is(
  (select product_name from public.sale_items where sale_id = pg_temp.vid('V1') and product_id = pg_temp.pid('SA')),
  'Venta SA fideos', 'V1: el ítem copia el nombre'
);
select is(
  (select unit_cost_price from public.sale_items where sale_id = pg_temp.vid('V1') and product_id = pg_temp.pid('SA')),
  100.00::numeric, 'V1: el ítem copia el costo'
);
select is((select amount from public.sale_payments where sale_id = pg_temp.vid('V1')), 3500.00::numeric, 'V1: pago en efectivo ya redondeado');
select is((select tendered_amount from public.sale_payments where sale_id = pg_temp.vid('V1')), 4000.00::numeric, 'V1: entregado 4.000 (vuelto 500)');
select is(pg_temp.lot('SA', 10), 2::numeric, 'V1: SA sale primero del lote que vence antes');
select is(pg_temp.lot('SA', 60), 20::numeric, 'V1: el lote B de SA no se toca');
select is(pg_temp.lot('SB', 30), 9::numeric, 'V1: SB sale del lote vigente');
select is(
  (select quantity_available from public.product_batches where product_id = pg_temp.pid('SB') and expires_on < private.today_ar()),
  5::numeric, 'V1: el lote vencido de SB no se toca (P-15)'
);
select is(
  (select count(*)::int from public.stock_movements where movement_type = 'sale' and operation_key = pg_temp.vid('V1')),
  2, 'V1: un movimiento sale por ítem y lote, con operation_key = id de la venta'
);
select ok(
  not exists (select 1 from public.stock_movements m where m.operation_key = pg_temp.vid('V1') and m.sale_item_id is null),
  'V1: todos los movimientos sale tienen su ítem'
);

-- Idempotencia.
select is(
  (select id from public.register_sale('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', pg_temp.sid('S1'),
    jsonb_build_array(pg_temp.it('SB', 1), pg_temp.it('SA', 2)),
    jsonb_build_array(pg_temp.pay('cash', 3500, 4000)))),
  pg_temp.vid('V1'), 'reintento (aun con los ítems en otro orden) devuelve la misma venta'
);
select is(pg_temp.stock_of('SA'), 22::numeric, 'el reintento no descuenta de nuevo (SA 22)');
select is((select count(*)::int from public.sales), 1, 'el reintento no crea otra venta');
select throws_ok(
  $$select public.register_sale('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('SA', 3)), jsonb_build_array(pg_temp.pay('cash', 3600)))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otros ítems -> IDEMPOTENCY_CONFLICT'
);
select throws_ok(
  $$select public.open_cash_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', (select id from public.cash_registers where name = 'Caja 2'), 0)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la clave de una venta no sirve para abrir una caja'
);

-- Venta 2: SA x5 = 6.050 -> efectivo 6.100 (+50). FEFO reparte entre dos lotes.
insert into t_s select 'V2', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('SA', 5)), jsonb_build_array(pg_temp.pay('cash', 6100, 6100)))).id;
select is((select rounding_amount from public.sales where id = pg_temp.vid('V2')), 50.00::numeric, 'V2: el redondeo sube 50 (desde la mitad)');
select is(pg_temp.lot('SA', 10), 0::numeric, 'V2: se agota el lote A de SA');
select is(pg_temp.lot('SA', 60), 17::numeric, 'V2: el resto sale del lote B');
select is(
  (select count(*)::int from public.stock_movements m join public.sale_items i on i.id = m.sale_item_id where i.sale_id = pg_temp.vid('V2')),
  2, 'V2: dos movimientos (uno por lote)'
);
select is(
  (select sum(m.quantity) from public.stock_movements m join public.sale_items i on i.id = m.sale_item_id where i.sale_id = pg_temp.vid('V2')),
  5::numeric, 'V2: los movimientos suman la cantidad vendida'
);

-- Venta 3: por kilo y pago mixto. 0,350 kg x 8.840 = 3.094; débito 1.000 + efectivo 2.100 (2.094 redondeado, +6).
insert into t_s select 'V3', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('SK', 0.35)),
  jsonb_build_array(pg_temp.pay('debit', 1000), pg_temp.pay('cash', 2100, 2500)))).id;
select is((select total_amount from public.sales where id = pg_temp.vid('V3')), 3094.00::numeric, 'V3: 0,350 kg x 8.840 = 3.094');
select is((select rounding_amount from public.sales where id = pg_temp.vid('V3')), 6.00::numeric, 'V3: cobró 3.100 por 3.094 con pago mixto (+6)');
select is((select sum(amount) from public.sale_payments where sale_id = pg_temp.vid('V3')), 3100.00::numeric, 'V3: pagos = total + redondeo');
select is(pg_temp.stock_of('SK'), 2.15::numeric, 'V3: stock por kilo con decimales');

-- Venta 4: todo con débito, sin redondeo.
insert into t_s select 'V4', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('SB', 1)), jsonb_build_array(pg_temp.pay('debit', 1105)))).id;
select is((select rounding_amount from public.sales where id = pg_temp.vid('V4')), 0.00::numeric, 'V4: con débito exacto no hay redondeo');

-- Líneas repetidas del mismo producto se suman en un solo ítem.
insert into t_s select 'V6', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('SL', 1), pg_temp.it('SL', 2)), jsonb_build_array(pg_temp.pay('debit', 145.20)))).id;
select is((select count(*)::int from public.sale_items where sale_id = pg_temp.vid('V6')), 1, 'líneas repetidas: un solo ítem');
select is((select quantity from public.sale_items where sale_id = pg_temp.vid('V6')), 3::numeric, 'líneas repetidas: cantidades sumadas');

-- Errores de la solicitud (nada se registra).
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), '[]'::jsonb, jsonb_build_array(pg_temp.pay('cash', 100)))$$,
  'P0001', 'EMPTY_SALE', 'sin ítems -> EMPTY_SALE'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 0)), jsonb_build_array(pg_temp.pay('cash', 100)))$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad 0 -> INVALID_QUANTITY'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', -1)), jsonb_build_array(pg_temp.pay('cash', 100)))$$,
  'P0001', 'INVALID_QUANTITY', 'cantidad negativa -> INVALID_QUANTITY'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1.5)), jsonb_build_array(pg_temp.pay('cash', 1800)))$$,
  'P0001', 'INVALID_QUANTITY', 'decimales en un producto por unidad -> INVALID_QUANTITY'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
      jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1)), jsonb_build_array(pg_temp.pay('cash', 100)))$$,
  'P0001', 'PRODUCT_NOT_FOUND', 'producto inexistente -> PRODUCT_NOT_FOUND'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SD', 1)), jsonb_build_array(pg_temp.pay('cash', 1200)))$$,
  'P0001', 'PRODUCT_INACTIVE', 'producto inactivo -> PRODUCT_INACTIVE'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SZ', 1)), jsonb_build_array(pg_temp.pay('cash', 100)))$$,
  'P0001', 'PRODUCT_PRICE_INVALID', 'producto sin precio -> PRODUCT_PRICE_INVALID'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), gen_random_uuid(), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('cash', 1200)))$$,
  'P0001', 'CASH_SESSION_NOT_FOUND', 'sesión inexistente -> CASH_SESSION_NOT_FOUND'
);

-- Stock insuficiente: no queda nada registrado (P-36: nunca stock negativo).
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1000, 0)), jsonb_build_array(pg_temp.pay('cash', 1210000)))$$,
  'P0001', 'INSUFFICIENT_STOCK', 'sin stock suficiente -> INSUFFICIENT_STOCK'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SB', 9, 0)), jsonb_build_array(pg_temp.pay('cash', 9900)))$$,
  'P0001', 'INSUFFICIENT_STOCK', 'el lote vencido no cuenta: SB tiene 8 vendibles, no 13'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
      jsonb_build_array(pg_temp.it('SL', 1), pg_temp.it('SA', 1000, 0)), jsonb_build_array(pg_temp.pay('cash', 1210000)))$$,
  'P0001', 'INSUFFICIENT_STOCK', 'una venta con un ítem sin stock falla entera'
);
select is(pg_temp.stock_of('SL'), 47::numeric, 'la venta fallida no descontó SL (queda 47 tras V6)');
select is(pg_temp.stock_of('SA'), 17::numeric, 'la venta fallida no descontó SA');
select is((select count(*)::int from public.sales), 5, 'las ventas fallidas no dejaron filas en sales (V1, V2, V3, V4, V6)');

-- Errores de pago.
-- Rechazos de pago. La base NO exige el monto sugerido (el cajero puede cambiarlo): solo que la
-- diferencia con el total quede estrictamente dentro de un múltiplo (aquí 100).
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('cash', 1310)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'cobrar 100 de más (1.310 por 1.210) -> PAYMENT_MISMATCH (el límite es estricto)'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('cash', 1110)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'cobrar 100 de menos (1.110 por 1.210) -> PAYMENT_MISMATCH'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('debit', 1000)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'el límite vale para cualquier medio: débito de 1.000 por 1.210 -> PAYMENT_MISMATCH'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)),
      jsonb_build_array(pg_temp.pay('debit', 1300), pg_temp.pay('cash', 100)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'pagos que superan el total en 190 -> PAYMENT_MISMATCH'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SL', 1)), jsonb_build_array(pg_temp.pay('cash', 148.40)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'una compra de 48,40 no se puede cobrar 148,40 (+100)'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('cash', 1200, 1000)))$$,
  'P0001', 'INVALID_PAYMENT', 'entregado menor al importe -> INVALID_PAYMENT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('debit', 1210, 1500)))$$,
  'P0001', 'INVALID_PAYMENT', 'entregado en un medio que no es efectivo -> INVALID_PAYMENT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)),
      jsonb_build_array(pg_temp.pay('debit', 600), pg_temp.pay('debit', 610)))$$,
  'P0001', 'INVALID_PAYMENT', 'el mismo medio dos veces -> INVALID_PAYMENT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('debit', 0)))$$,
  'P0001', 'INVALID_PAYMENT', 'importe de pago 0 -> INVALID_PAYMENT'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)),
      jsonb_build_array(jsonb_build_object('payment_method_id', gen_random_uuid(), 'amount', 1210)))$$,
  'P0001', 'PAYMENT_METHOD_INVALID', 'medio de pago inexistente -> PAYMENT_METHOD_INVALID'
);
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), '[]'::jsonb)$$,
  'P0001', 'PAYMENT_MISMATCH', 'sin pagos -> PAYMENT_MISMATCH'
);

-- La empleada no puede escribir directo en las tablas nuevas.
select throws_ok($$insert into public.sales (idempotency_key, request_hash, cash_session_id, total_amount, net_amount, vat_amount)
  values (gen_random_uuid(), 'x', (select id from public.cash_sessions limit 1), 1, 1, 0)$$, '42501', null, 'INSERT directo en sales -> denegado');
select throws_ok($$insert into public.sale_items (sale_id, product_id, quantity, unit_price_with_vat, vat_rate, line_total, net_amount, vat_amount,
  unit_cost_price, product_sku, product_name) values (gen_random_uuid(), gen_random_uuid(), 1, 1, 21, 1, 1, 0, 1, 'x', 'x')$$,
  '42501', null, 'INSERT directo en sale_items -> denegado');
select throws_ok($$insert into public.sale_payments (sale_id, payment_method_id, amount) values (gen_random_uuid(), gen_random_uuid(), 1)$$,
  '42501', null, 'INSERT directo en sale_payments -> denegado');
select throws_ok($$insert into public.cash_sessions (idempotency_key, cash_register_id, opening_amount)
  values (gen_random_uuid(), (select id from public.cash_registers limit 1), 0)$$, '42501', null, 'INSERT directo en cash_sessions -> denegado');
select throws_ok($$update public.sales set total_amount = 1$$, '42501', null, 'UPDATE directo en sales -> denegado');
select throws_ok($$update public.cash_sessions set opening_amount = 1$$, '42501', null, 'UPDATE directo en cash_sessions -> denegado');
select throws_ok($$delete from public.sales$$, '42501', null, 'DELETE directo en sales -> denegado');

-- Los movimientos de venta solo salen de register_sale.
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('SA'), 'sale', 1)$$,
  'P0001', 'NOT_AUTHORIZED', 'la empleada no usa register_product_movement con sale'
);
reset role;

-- ---------------------------------------------------------------------------
-- Visibilidad (P-33, P-34, P-40): Ema, otra empleada
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ce", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.sales), 0, 'Ema no ve las ventas de Eva (P-34)');
select is((select count(*)::int from public.sale_items), 0, 'Ema no ve ítems de ventas ajenas');
select is((select count(*)::int from public.sale_payments), 0, 'Ema no ve pagos de ventas ajenas');
select is((select count(*)::int from public.cash_sessions where status = 'open'), (select n + 2 from t_base where k = 'open'), 'Ema ve las sesiones abiertas (para elegir caja, P-33)');
select is(
  (select expected_cash from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  null::numeric, 'arqueo a ciegas: Ema no ve el efectivo esperado de una sesión abierta (P-40)'
);
select is(
  (select cash_collected from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  null::numeric, 'arqueo a ciegas: tampoco el efectivo cobrado'
);
select is((select count(*)::int from public.v_cash_session_payments), 0, 'Ema no ve pagos por medio de sesiones ajenas');

-- Ema vende en la sesión abierta de Eva (P-33).
insert into t_s select 'V5', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('SB', 1)), jsonb_build_array(pg_temp.pay('transfer', 1105)))).id;
select is((select count(*)::int from public.sales), 1, 'Ema ve solo su propia venta');
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), pg_temp.vid('V5'), 'Error de carga')$$,
  'P0001', 'NOT_AUTHORIZED', 'una empleada no anula ventas'
);
select throws_ok(
  $$select public.close_cash_session(pg_temp.sid('S1'), 0)$$,
  'P0001', 'NOT_AUTHORIZED', 'una empleada no cierra la caja de otra'
);
select lives_ok($$update public.sales_settings set rounding_multiple = 5$$, 'una empleada que intenta cambiar el múltiplo no recibe error (la RLS filtra la fila)');
reset role;
select is((select rounding_multiple from public.sales_settings), 100.00::numeric, 'el múltiplo sigue en 100');

-- ---------------------------------------------------------------------------
-- Encargado: ve todo, anula, configura
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.sales), (select n + 6 from t_base where k = 'sales'), 'el encargado ve todas las ventas (V1 a V6)');
select is(
  (select cash_collected from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  11700.00::numeric, 'resumen: efectivo cobrado = 3.500 + 6.100 + 2.100 (con redondeo)'
);
select is(
  (select expected_cash from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  12200.00::numeric, 'resumen: esperado de la sesión abierta = 500 de apertura + 11.700'
);
select is(
  (select rounding_total from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  31.00::numeric, 'resumen: redondeos acumulados = -25 + 50 + 6'
);
select is(
  (select sales_count from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  6, 'resumen: 6 ventas completadas'
);
select is(
  (select amount_total from public.v_cash_session_payments
    where cash_session_id = pg_temp.sid('S1') and payment_method_code = 'debit'),
  1000.00 + 1105.00 + 145.20, 'pagos por medio: débito acumulado'
);

-- Anulación.
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), pg_temp.vid('V1'), '  ')$$,
  'P0001', 'REASON_REQUIRED', 'anular sin motivo -> REASON_REQUIRED'
);
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), gen_random_uuid(), 'x')$$,
  'P0001', 'SALE_NOT_FOUND', 'venta inexistente -> SALE_NOT_FOUND'
);
select is(
  (select status::text from public.void_sale('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', pg_temp.vid('V1'), 'Se equivocó el producto')),
  'voided', 'el encargado anula V1'
);
select is((select void_reason from public.sales where id = pg_temp.vid('V1')), 'Se equivocó el producto', 'queda el motivo de la anulación');
select is((select voided_by from public.sales where id = pg_temp.vid('V1')), '00000000-0000-4000-8000-0000000000cb'::uuid, 'queda quién anuló');
select is(pg_temp.lot('SA', 10), 2::numeric, 'anular devuelve SA al MISMO lote (A vuelve a 2)');
select is(pg_temp.lot('SB', 30), 8::numeric, 'anular devuelve SB al lote vigente (7 + 1)');
select is(
  (select count(*)::int from public.stock_movements where operation_key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01' and movement_type = 'adjustment_in'),
  2, 'la anulación crea un movimiento compensatorio por movimiento de venta'
);
select ok(
  not exists (select 1 from public.stock_movements m where m.operation_key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01' and m.reverses_movement_id is null),
  'cada compensación apunta a su movimiento original (reverses_movement_id)'
);
select is(
  (select status::text from public.void_sale('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', pg_temp.vid('V1'), 'Se equivocó el producto')),
  'voided', 'reintento de la anulación con la misma clave devuelve la venta'
);
select is(pg_temp.lot('SA', 10), 2::numeric, 'el reintento de la anulación no devuelve stock dos veces');
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), pg_temp.vid('V1'), 'Otra vez')$$,
  'P0001', 'ALREADY_VOIDED', 'anular dos veces con otra clave -> ALREADY_VOIDED'
);
select throws_ok(
  $$select * from public.reverse_stock_movement(gen_random_uuid(),
      (select m.id from public.stock_movements m where m.movement_type = 'sale' limit 1), 'Corrección manual')$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'un movimiento sale no se revierte a mano: solo con void_sale'
);
select throws_ok(
  $$select * from public.register_product_movement(gen_random_uuid(), pg_temp.pid('SA'), 'sale', 1, 'x')$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'register_product_movement rechaza el tipo sale'
);
select throws_ok(
  $$select public.register_stock_movement(gen_random_uuid(), (select id from public.product_batches where product_id = pg_temp.pid('SA') limit 1), 'sale', 1, 'x')$$,
  'P0001', 'INVALID_MOVEMENT_TYPE', 'register_stock_movement rechaza el tipo sale'
);
select is(
  (select expected_cash from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  8700.00::numeric, 'una venta anulada sale del esperado: 500 + 6.100 + 2.100'
);

-- Configuración: múltiplo 50 para las ventas nuevas.
update public.sales_settings set rounding_multiple = 50;
select is((select rounding_multiple from public.sales_settings), 50.00::numeric, 'el encargado cambia el múltiplo');
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S2'), jsonb_build_array(pg_temp.it('SA', 2), pg_temp.it('SB', 1)),
      jsonb_build_array(pg_temp.pay('cash', 3600)))$$,
  'P0001', 'PAYMENT_MISMATCH', 'con múltiplo 50, cobrar 75 de más (3.600 por 3.525) supera el límite'
);
insert into t_s select 'V7', (public.register_sale(gen_random_uuid(), pg_temp.sid('S2'),
  jsonb_build_array(pg_temp.it('SA', 2), pg_temp.it('SB', 1)),
  jsonb_build_array(pg_temp.pay('cash', 3550, 3550)))).id;
select is((select rounding_amount from public.sales where id = pg_temp.vid('V7')), 25.00::numeric, 'V7: con múltiplo 50, cobrar 3.550 por 3.525 (+25)');
select is((select rounding_amount from public.sales where id = pg_temp.vid('V2')), 50.00::numeric, 'las ventas anteriores no cambian con el nuevo múltiplo');
select is((select rounding_multiple from public.sales where id = pg_temp.vid('V7')), 50.00::numeric, 'V7 guarda el múltiplo vigente al vender (50)');
select is((select rounding_multiple from public.sales where id = pg_temp.vid('V2')), 100.00::numeric, 'V2 guarda el múltiplo que regía entonces (100)');

-- Compra de menos de la mitad del múltiplo: se cobra exacta (P-39). Con múltiplo 50 igual vale el mínimo de 25.
insert into t_s select 'V8', (public.register_sale(gen_random_uuid(), pg_temp.sid('S2'),
  jsonb_build_array(pg_temp.it('SL', 1)), jsonb_build_array(pg_temp.pay('cash', 48.40, 50)))).id;
select is((select rounding_amount from public.sales where id = pg_temp.vid('V8')), 0.00::numeric, 'V8: 48,40 en efectivo exacto, sin redondeo');
select is((select tendered_amount from public.sale_payments where sale_id = pg_temp.vid('V8')), 50.00::numeric, 'V8: recibió 50 (vuelto 1,60)');
update public.sales_settings set rounding_multiple = 100;
reset role;

select is(
  (select count(*)::int from public.audit_log where table_name = 'sales_settings' and action = 'update'),
  2, 'los cambios del múltiplo quedan en audit_log'
);

-- ---------------------------------------------------------------------------
-- Cierre de caja y arqueo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cc", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.close_cash_session(pg_temp.sid('S1'), -5)$$, 'P0001', 'INVALID_AMOUNT', 'conteo negativo -> INVALID_AMOUNT');
select is(
  (select status::text from public.close_cash_session(pg_temp.sid('S1'), 8650, 'Faltan 50')),
  'closed', 'Eva cierra su caja'
);
select is((select expected_cash from public.cash_sessions where id = pg_temp.sid('S1')), 8700.00::numeric, 'esperado guardado = 500 + 6.100 + 2.100');
select is((select counted_cash from public.cash_sessions where id = pg_temp.sid('S1')), 8650.00::numeric, 'contado guardado');
select is((select difference from public.cash_sessions where id = pg_temp.sid('S1')), -50.00::numeric, 'diferencia = contado - esperado (faltante de 50)');
select is((select closed_by from public.cash_sessions where id = pg_temp.sid('S1')), '00000000-0000-4000-8000-0000000000cc'::uuid, 'closed_by es quien cerró');
select is(
  (select difference from public.v_cash_session_summary where cash_session_id = pg_temp.sid('S1')),
  -50.00::numeric, 'cerrada: Eva ve su diferencia'
);
select throws_ok($$select public.close_cash_session(pg_temp.sid('S1'), 8650)$$, 'P0001', 'CASH_SESSION_CLOSED', 'cerrar dos veces -> CASH_SESSION_CLOSED');
select throws_ok(
  $$select public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('SA', 1)), jsonb_build_array(pg_temp.pay('cash', 1200)))$$,
  'P0001', 'CASH_SESSION_CLOSED', 'vender en una caja cerrada -> CASH_SESSION_CLOSED'
);
select is(
  (select id from public.register_sale('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', pg_temp.sid('S1'),
    jsonb_build_array(pg_temp.it('SA', 2), pg_temp.it('SB', 1)), jsonb_build_array(pg_temp.pay('cash', 3500, 4000)))),
  pg_temp.vid('V1'), 'reintento de una venta ya hecha después del cierre devuelve la original'
);
select is((select count(*)::int from public.cash_sessions where status = 'closed'), 1, 'Eva solo ve su sesión cerrada');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ce", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.cash_sessions where status = 'closed'), 0, 'Ema no ve sesiones cerradas de otra');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000cb", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), pg_temp.vid('V2'), 'Tarde')$$,
  'P0001', 'CASH_SESSION_CLOSED', 'anular con la sesión de caja cerrada -> CASH_SESSION_CLOSED (P-32)'
);
select is(
  (select status::text from public.close_cash_session(pg_temp.sid('S2'), 3698.40)),
  'closed', 'el encargado cierra la Caja 2'
);
select is((select expected_cash from public.cash_sessions where id = pg_temp.sid('S2')), 3698.40::numeric, 'Caja 2: esperado = 100 + 3.550 + 48,40');
select is((select difference from public.cash_sessions where id = pg_temp.sid('S2')), 0.00::numeric, 'Caja 2: arqueo sin diferencia');
reset role;

-- ---------------------------------------------------------------------------
-- Inmutabilidad e integridad (como superusuario: los triggers valen para todos)
-- ---------------------------------------------------------------------------
select throws_ok($$update public.sales set total_amount = 1 where id = pg_temp.vid('V2')$$, '42501', null, 'una venta no se edita');
select throws_ok($$update public.sales set status = 'voided', voided_at = now(), voided_by = '00000000-0000-4000-8000-0000000000cb',
  void_reason = 'x', total_amount = 5 where id = pg_temp.vid('V2')$$, '42501', null, 'anular no puede cambiar otros datos');
select throws_ok($$delete from public.sales where id = pg_temp.vid('V2')$$, '42501', null, 'una venta no se borra');
select throws_ok($$update public.sale_items set quantity = 9 where sale_id = pg_temp.vid('V2')$$, '42501', null, 'un ítem no se edita');
select throws_ok($$delete from public.sale_items where sale_id = pg_temp.vid('V2')$$, '42501', null, 'un ítem no se borra');
select throws_ok($$update public.sale_payments set amount = 1 where sale_id = pg_temp.vid('V2')$$, '42501', null, 'un pago no se edita');
select throws_ok($$delete from public.sale_payments where sale_id = pg_temp.vid('V2')$$, '42501', null, 'un pago no se borra');
select throws_ok($$update public.cash_sessions set counted_cash = 1 where id = pg_temp.sid('S1')$$, '42501', null, 'una sesión cerrada no se edita');
select throws_ok($$delete from public.cash_sessions where id = pg_temp.sid('S1')$$, '42501', null, 'una sesión no se borra');
select throws_ok($$truncate public.sale_payments$$, '42501', null, 'sale_payments no admite TRUNCATE');
select throws_ok($$update public.payment_methods set is_cash = false where code = 'cash'$$, '23514', null, 'is_cash de un medio no se cambia');
select throws_ok($$update public.payment_methods set code = 'otro' where code = 'debit'$$, '23514', null, 'el código de un medio no se cambia');
select throws_ok($$delete from public.payment_methods where code = 'qr'$$, '42501', null, 'los medios de pago no se borran');
select throws_ok($$insert into public.sales_settings (rounding_multiple) values (10)$$, '23505', null, 'sales_settings admite una sola fila');
select throws_ok($$insert into public.payment_methods (code, name, is_cash) values ('efvo_dos', 'Otro efectivo', true)$$, '23505', null, 'no puede haber dos medios en efectivo');

-- El segundo descuento del mismo ítem y lote lo frena un índice único.
select throws_ok(
  $$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by, sale_item_id)
    select gen_random_uuid(), m.product_id, m.batch_id, 'sale', 1, 0, m.created_by, m.sale_item_id
    from public.stock_movements m where m.movement_type = 'sale' limit 1$$,
  '23505', null, 'el mismo ítem no descuenta dos veces del mismo lote (índice único)'
);
select throws_ok(
  $$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    select gen_random_uuid(), m.product_id, m.batch_id, 'sale', 1, 0, m.created_by from public.stock_movements m limit 1$$,
  '23514', null, 'un movimiento sale sin ítem de venta se rechaza (CHECK)'
);

-- El límite del redondeo está en la propia fila.
select throws_ok(
  $$insert into public.sales (idempotency_key, request_hash, cash_session_id, total_amount, net_amount, vat_amount, rounding_amount, rounding_multiple)
    values (gen_random_uuid(), 'x', (select id from public.cash_sessions limit 1), 100, 100, 0, 100, 100)$$,
  '23514', null, 'CHECK: el redondeo no puede llegar a un múltiplo entero'
);

-- Una venta inconsistente no se puede confirmar: pagos que no suman.
insert into public.sales (id, idempotency_key, request_hash, cash_session_id, total_amount, net_amount, vat_amount, rounding_amount, rounding_multiple, created_by)
values ('00000000-0000-4000-8000-0000000000f1', gen_random_uuid(), 'x', pg_temp.sid('S2'), 100, 100, 0, 0, 100, '00000000-0000-4000-8000-0000000000cc');
select throws_ok(
  $$set constraints sales_consistency_check immediate$$,
  '23514', null, 'una venta sin ítems ni pagos no se puede confirmar (consistencia diferida)'
);

-- Conciliación: el saldo de cada lote coincide con el ledger.
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0, 'conciliación: ningún lote descuadrado después de ventas y anulaciones'
);

select * from finish();
rollback;
