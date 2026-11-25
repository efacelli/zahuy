-- Correcciones de cuentas corrientes (contrato v0.13.1, §23). Solo datos ficticios.
-- El bloqueo del cliente al anular un pago necesita dos conexiones; acá se prueba el comportamiento
-- de una sola (la concurrencia se verificó a mano en la base local).
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'elsa.encargada.cc@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000d1';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000d0c1', 'Categoría cc2');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000d0b1', 'Marca cc2');

create temporary table t_ids (code text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;
create function pg_temp.id(c text) returns uuid language sql as $$ select id from t_ids where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
create function pg_temp.items(q numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('P'), 'quantity', q)) $$;
create function pg_temp.pay(m text, a numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid(m), 'amount', a)) $$;
grant execute on function pg_temp.id(text), pg_temp.mid(text), pg_temp.items(numeric), pg_temp.pay(text, numeric) to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;

insert into t_ids select 'P', (public.create_product(gen_random_uuid(), 'Producto cc2', '00000000-0000-4000-8000-00000000d0c1',
  '00000000-0000-4000-8000-00000000d0b1', 'unit', 100, 1000, 21, p_initial_quantity => 10, p_expires_on => private.today_ar() + 90)).id;
insert into public.customers (name, credit_limit) values ('Carla Ficticia', 5000);
insert into t_ids select 'C', id from public.customers where name = 'Carla Ficticia';
insert into public.customers (name, credit_limit) values ('Dario Ficticio', 5000);
insert into t_ids select 'D', id from public.customers where name = 'Dario Ficticio';
insert into t_ids select 'S', (public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 0)).id;

insert into t_ids values ('K', gen_random_uuid());
insert into t_ids select 'V', (public.register_account_sale(pg_temp.id('K'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1), pg_temp.pay('account', 1210))).id;
set constraints all immediate;
set constraints all deferred;

update public.customers set is_active = false where id in (pg_temp.id('C'), pg_temp.id('D'));

select is(
  (public.register_account_sale(pg_temp.id('K'), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1), pg_temp.pay('account', 1210))).id,
  pg_temp.id('V'), 'el reintento devuelve la venta aunque el cliente se haya desactivado');
select throws_ok($$select public.register_account_sale(pg_temp.id('K'), pg_temp.id('S'), pg_temp.id('D'), pg_temp.items(1), pg_temp.pay('account', 1210))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'la misma clave con otro cliente sigue siendo un conflicto');
select throws_ok($$select public.register_account_sale(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.items(1), pg_temp.pay('account', 1210))$$,
  'P0001', 'CUSTOMER_NOT_FOUND', 'una venta nueva a un cliente desactivado se rechaza');
select is((select count(*)::int from public.sales where cash_session_id = pg_temp.id('S')), 1,
  'la venta rechazada no queda registrada');
select is((select sum(quantity_available)::numeric from public.product_batches where product_id = pg_temp.id('P')), 9::numeric,
  'ni descuenta stock');
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), 1210.00::numeric,
  'la deuda no cambia');

-- Anular un pago sigue funcionando (ahora bloquea también al cliente).
insert into t_ids select 'Y', (public.register_customer_payment(gen_random_uuid(), pg_temp.id('S'), pg_temp.id('C'), pg_temp.mid('cash'), 200)).id;
select isnt((public.void_customer_payment(pg_temp.id('Y'), 'Prueba')).voided_at, null, 'se anula un pago');
select is((select balance from public.v_customer_balances where customer_id = pg_temp.id('C')), 1210.00::numeric,
  'y la deuda vuelve');
reset role;

select ok(not has_function_privilege('anon', 'public.register_account_sale(uuid, uuid, uuid, jsonb, jsonb, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.void_customer_payment(uuid, text)', 'execute'),
  'anon sigue sin poder ejecutar las funciones');
select ok(has_function_privilege('authenticated', 'public.register_account_sale(uuid, uuid, uuid, jsonb, jsonb, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.void_customer_payment(uuid, text)', 'execute'),
  'authenticated conserva el permiso');

select * from finish();
rollback;
