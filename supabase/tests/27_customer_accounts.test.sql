-- Clientes y cuentas corrientes (contrato v0.13.0, §23). Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select is((select count(*)::int from public.payment_methods where code = 'account' and not is_cash and is_active), 1,
  'existe el medio de pago «Cuenta corriente» (no es efectivo)');
select is((select count(*)::int from public.customers), 0, 'no hay clientes al migrar');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'enzo.encargado.cc@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'eva.empleada.cc@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'ivan.inactivo.cc@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000c1';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000c3';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000c0c1', 'Categoría cc');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000c0b1', 'Marca cc');

create temporary table t_ids (code text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;
create function pg_temp.id(c text) returns uuid language sql as $$ select id from t_ids where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
create function pg_temp.items(q numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('P'), 'quantity', q)) $$;
create function pg_temp.pay(m text, a numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid(m), 'amount', a)) $$;
grant execute on function pg_temp.id(text), pg_temp.mid(text), pg_temp.items(numeric), pg_temp.pay(text, numeric) to authenticated;

create function pg_temp.as_user(u text) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;

-- ---------------------------------------------------------------------------
-- Encargado: producto (1.000 sin IVA, 21 % -> 1.210), clientes y caja
-- ---------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
set local role authenticated;
insert into t_ids select 'P', (public.create_product(gen_random_uuid(), 'Producto cc', '00000000-0000-4000-8000-00000000c0c1',
  '00000000-0000-4000-8000-00000000c0b1', 'unit', 100, 1000, 21, p_initial_quantity => 100, p_expires_on => private.today_ar() + 90)).id;
insert into public.customers (name, document_number, credit_limit) values ('Juana Ficticia', '20111222', 5000);
insert into t_ids select 'C', id from public.customers where name = 'Juana Ficticia';
insert into public.customers (name, credit_limit, is_blocked, blocked_reason) values ('Bruno Bloqueado', 100000, true, 'Prueba');
insert into t_ids select 'B', id from public.customers where name = 'Bruno Bloqueado';
select throws_ok($$insert into public.customers (name, document_number) values ('Otro', '20111222')$$, '23505', null,
  'el documento del cliente es único');
select throws_ok($$insert into public.customers (name, document_number) values ('Otro', '12-3')$$, '23514', null,
  'el documento solo admite dígitos');
select throws_ok($$insert into public.customers (name, credit_limit) values ('Otro', -1)$$, '23514', null,
  'el límite no puede ser negativo');
select throws_ok($$update public.customers set over_limit_authorized_until = now() where id = pg_temp.id('C')$$, '42501', null,
  'la autorización por encima del límite no se escribe directo');
select throws_ok($$delete from public.customers where id = pg_temp.id('C')$$, '42501', null, 'los clientes no se borran');
reset role;

-- ---------------------------------------------------------------------------
-- Empleada: no administra clientes, pero vende a cuenta y cobra
-- ---------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
set local role authenticated;
select is((select count(*)::int from public.customers), 2, 'la empleada ve los clientes (para elegir en la caja)');
select throws_ok($$insert into public.customers (name) values ('No')$$, '42501', null, 'la empleada no crea clientes');
update public.customers set credit_limit = 999999 where id = pg_temp.id('C');
select is((select credit_limit from public.customers where id = pg_temp.id('C')), 5000.00::numeric,
  'la empleada no cambia el límite (la RLS no le deja actualizar)');
select throws_ok($$select public.authorize_customer_over_limit(pg_temp.id('C'))$$, 'P0001', 'NOT_AUTHORIZED',
  'la empleada no autoriza ventas por encima del límite');

insert into t_ids select 'S', (public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 0)).id;

-- register_sale con 'account' y sin cliente: se rechaza al confirmar.
select throws_ok($$select public.register_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.items(1), pg_temp.pay('account', 1210));
                   set constraints all immediate$$,
  'P0001', 'ACCOUNT_CUSTOMER_REQUIRED', 'una venta con cuenta corriente sin cliente no se confirma');

select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1), pg_temp.pay('cash', 1210))$$,
  'P0001', 'ACCOUNT_PAYMENT_REQUIRED', 'register_account_sale exige un pago con cuenta corriente');
select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('B'), pg_temp.items(1), pg_temp.pay('account', 1210))$$,
  'P0001', 'ACCOUNT_BLOCKED', 'a un cliente bloqueado no se le vende a cuenta');
select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), gen_random_uuid(), pg_temp.items(1), pg_temp.pay('account', 1210))$$,
  'P0001', 'CUSTOMER_NOT_FOUND', 'cliente inexistente');

-- Venta mixta: 1.210 = 210 efectivo + 1.000 a cuenta.
insert into t_ids values ('K1', gen_random_uuid());
insert into t_ids select 'V1', (public.register_account_sale(pg_temp.id('K1'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1),
  jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid('cash'), 'amount', 210),
                    jsonb_build_object('payment_method_id', pg_temp.mid('account'), 'amount', 1000)))).id;
set constraints all immediate;
set constraints all deferred;
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), 1000.00::numeric,
  'la venta deja 1.000 de deuda');
select is((select available_credit from public.v_customer_balances where customer_id = pg_temp.id('C')), 4000.00::numeric,
  'crédito disponible: 4.000');
select is(
  (public.register_account_sale(pg_temp.id('K1'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1),
    jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid('cash'), 'amount', 210),
                      jsonb_build_object('payment_method_id', pg_temp.mid('account'), 'amount', 1000)))).id,
  pg_temp.id('V1'), 'el reintento con la misma clave devuelve la misma venta');
select is((select count(*)::int from public.customer_account_charges where customer_id = pg_temp.id('C')), 1,
  'el reintento no duplica el cargo');

-- Límite: 1.000 + 4.840 = 5.840 > 5.000.
select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(4), pg_temp.pay('account', 4840))$$,
  'P0001', 'CREDIT_LIMIT_EXCEEDED', 'superar el límite se rechaza');
select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(4), pg_temp.pay('account', 4840), null, true)$$,
  'P0001', 'CREDIT_LIMIT_EXCEEDED', 'la empleada no puede autorizarse sola con p_allow_over_limit');
reset role;

-- El encargado autoriza UNA venta por encima del límite.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
set local role authenticated;
select isnt((public.authorize_customer_over_limit(pg_temp.id('C'))).over_limit_authorized_until, null, 'el encargado autoriza');
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
set local role authenticated;
insert into t_ids select 'V2', (public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(4), pg_temp.pay('account', 4840))).id;
select is((select over_limit from public.customer_account_charges where sale_id = pg_temp.id('V2')), true, 'el cargo queda marcado por encima del límite');
select is((select over_limit_authorized_until from public.customers where id = pg_temp.id('C')), null, 'la autorización se usa una sola vez');
select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1), pg_temp.pay('account', 1210))$$,
  'P0001', 'CREDIT_LIMIT_EXCEEDED', 'sin una autorización nueva vuelve a rechazarse');
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), 5840.00::numeric, 'deuda: 5.840');

-- Pagos en la caja.
select throws_ok($$select public.register_customer_payment(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('cash'), 6000)$$,
  'P0001', 'PAYMENT_EXCEEDS_BALANCE', 'no se cobra más que la deuda');
select throws_ok($$select public.register_customer_payment(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('account'), 100)$$,
  'P0001', 'PAYMENT_METHOD_INVALID', 'una deuda no se paga con cuenta corriente');
select throws_ok($$select public.register_customer_payment(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('cash'), 0)$$,
  'P0001', 'INVALID_AMOUNT', 'pago en cero');
select throws_ok($$select public.register_customer_payment(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('debit'), 100, 200)$$,
  'P0001', 'INVALID_PAYMENT', 'solo el efectivo tiene «recibido»');
insert into t_ids values ('K2', gen_random_uuid());
insert into t_ids select 'Y1', (public.register_customer_payment(pg_temp.id('K2'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('cash'), 2000, 2500)).id;
select is((public.register_customer_payment(pg_temp.id('K2'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('cash'), 2000, 2500)).id,
  pg_temp.id('Y1'), 'el reintento del pago devuelve el mismo pago');
select throws_ok($$select public.register_customer_payment(pg_temp.id('K2'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('cash'), 1000)$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la misma clave con otro importe es un conflicto');
insert into t_ids select 'Y2', (public.register_customer_payment(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('transfer'), 500)).id;
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), 3340.00::numeric, 'deuda después de pagar 2.500: 3.340');
select throws_ok($$select public.void_customer_payment(pg_temp.id('Y2'), 'error')$$, 'P0001', 'NOT_AUTHORIZED', 'la empleada no anula pagos');
select is((select count(*)::int from public.v_customer_account_movements where customer_id = pg_temp.id('C')), 4,
  'el estado de cuenta muestra 2 cargos y 2 pagos');
select throws_ok($$update public.customer_payments set amount = 1 where id = pg_temp.id('Y1')$$, '42501', null,
  'los pagos no se editan directo');
reset role;

-- ---------------------------------------------------------------------------
-- Encargado: anula un pago y una venta; el arqueo suma el efectivo de las cuentas
-- ---------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.void_customer_payment(pg_temp.id('Y2'), ' ')$$, 'P0001', 'REASON_REQUIRED', 'anular un pago pide motivo');
select isnt((public.void_customer_payment(pg_temp.id('Y2'), 'Transferencia no recibida')).voided_at, null, 'el encargado anula un pago');
select throws_ok($$select public.void_customer_payment(pg_temp.id('Y2'), 'otra vez')$$, 'P0001', 'ALREADY_VOIDED', 'un pago se anula una sola vez');
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), 3840.00::numeric, 'el pago anulado vuelve a la deuda');

select isnt((public.void_sale(gen_random_uuid(), pg_temp.id('V2'), 'Prueba')).voided_at, null, 'el encargado anula la venta por encima del límite');
select isnt((select voided_at from public.customer_account_charges where sale_id = pg_temp.id('V2')), null, 'anular la venta anula su cargo');
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), -1000.00::numeric,
  'la deuda baja con la venta anulada (queda a favor lo ya pagado)');

-- Arqueo: 210 de la venta en efectivo + 2.000 del pago en efectivo (el vuelto no entra).
select is((select expected_cash from public.v_cash_session_summary where cash_session_id = pg_temp.id('S')), 2210.00::numeric,
  'el efectivo esperado suma los pagos de cuenta corriente en efectivo');
select is((select account_cash_collected from public.v_cash_session_summary where cash_session_id = pg_temp.id('S')), 2000.00::numeric,
  'la vista informa el efectivo cobrado de cuentas');
select is((public.close_cash_session(pg_temp.id('S'), 2210)).difference, 0.00::numeric, 'el cierre de caja cuadra con los pagos de cuenta');
select throws_ok($$select public.void_customer_payment(pg_temp.id('Y1'), 'tarde')$$, 'P0001', 'CASH_SESSION_CLOSED',
  'con la caja cerrada el pago ya no se anula');
reset role;

-- ---------------------------------------------------------------------------
-- Inactivo y anon
-- ---------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select is((select (select count(*) from public.customers) + (select count(*) from public.customer_payments)
  + (select count(*) from public.customer_account_charges) + (select count(*) from public.v_customer_balances))::int, 0,
  'el inactivo no ve clientes ni cuentas');
select throws_ok($$select public.register_customer_payment(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1)$$,
  'P0001', 'NOT_AUTHORIZED', 'el inactivo no cobra');
select throws_ok($$select public.register_account_sale(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '[]', '[]')$$,
  'P0001', 'NOT_AUTHORIZED', 'el inactivo no vende a cuenta');
reset role;

select * from finish();
rollback;
