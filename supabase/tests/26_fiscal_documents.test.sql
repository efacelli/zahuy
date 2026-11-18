-- Facturación electrónica ARCA, capa de base de datos (contrato v0.12.0, §22). Solo datos ficticios.
-- No habla con ARCA: prueba tablas, funciones, permisos y reglas de integridad.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estado inicial
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.fiscal_settings), 1, 'hay una sola fila de configuración fiscal');
select is((select environment from public.fiscal_settings), 'off', 'el ambiente fiscal es off por defecto');
select is((select pto_vta from public.fiscal_settings), null, 'sin punto de venta cargado por defecto');
select is((select count(*)::int from public.fiscal_documents), 0, 'ningún documento fiscal existe al migrar');
select throws_ok($$insert into public.fiscal_settings (environment) values ('off')$$, '23505', null, 'no puede haber una segunda fila de configuración');
select throws_ok($$delete from public.fiscal_settings$$, null, null, 'la configuración no se borra');

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'enzo.encargado.fis@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000f2', 'eva.empleada.fis@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000f3', 'dora.duena.fis@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000f4', 'paco.programador.fis@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000f5', 'ivan.inactivo.fis@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000f6', 'olga.otra.empleada.fis@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000f1';
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000f3';
update public.profiles set role = 'developer' where id = '00000000-0000-4000-8000-0000000000f4';
update public.profiles set role = 'manager', is_active = false where id = '00000000-0000-4000-8000-0000000000f5';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-00000000f0c1', 'Categoría fiscal');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000f0b1', 'Marca fiscal');

create temporary table t_p (code text primary key, id uuid) on commit drop;
create temporary table t_s (code text primary key, id uuid) on commit drop;
create temporary table t_c (code text primary key, id uuid) on commit drop;
create temporary table t_d (code text primary key, id uuid) on commit drop;
grant all on t_p, t_s, t_c, t_d to authenticated, service_role;

create function pg_temp.pid(c text) returns uuid language sql as $$ select id from t_p where code = c $$;
create function pg_temp.vid(c text) returns uuid language sql as $$ select id from t_s where code = c $$;
create function pg_temp.sid(c text) returns uuid language sql as $$ select id from t_c where code = c $$;
create function pg_temp.did(c text) returns uuid language sql as $$ select id from t_d where code = c $$;
create function pg_temp.mid(c text) returns uuid language sql as $$ select id from public.payment_methods where code = c $$;
create function pg_temp.it(p text, q numeric) returns jsonb language sql as
  $$ select jsonb_build_object('product_id', pg_temp.pid(p), 'quantity', q) $$;
create function pg_temp.debit(a numeric) returns jsonb language sql as
  $$ select jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.mid('debit'), 'amount', a, 'tendered_amount', null)) $$;
grant execute on function pg_temp.pid(text), pg_temp.vid(text), pg_temp.sid(text), pg_temp.did(text), pg_temp.mid(text),
  pg_temp.it(text, numeric), pg_temp.debit(numeric) to authenticated, service_role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
-- U21: 1.000 sin IVA (21 %) -> 1.210. U10: 1.000 sin IVA (10,5 %) -> 1.105.
insert into t_p select 'U21', (public.create_product(gen_random_uuid(), 'Fiscal U21', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'unit', 100, 1000, 21, p_initial_quantity => 100, p_expires_on => private.today_ar() + 90)).id;
insert into t_p select 'U10', (public.create_product(gen_random_uuid(), 'Fiscal U10', '00000000-0000-4000-8000-00000000f0c1',
  '00000000-0000-4000-8000-00000000f0b1', 'unit', 100, 1000, 10.5, p_initial_quantity => 100, p_expires_on => private.today_ar() + 90)).id;
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
set local role authenticated;
insert into t_c select 'S1', (public.open_cash_session(gen_random_uuid(), (select id from public.cash_registers where name = 'Caja 1'), 0)).id;
insert into t_s select 'V1', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('U21', 1)), pg_temp.debit(1210))).id;
insert into t_s select 'V2', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('U21', 1), pg_temp.it('U10', 1)), pg_temp.debit(2315))).id;
insert into t_s select 'V3', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('U21', 2)), pg_temp.debit(2420))).id;
insert into t_s select 'V4', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('U10', 1)), pg_temp.debit(1105))).id;
-- Con redondeo del efectivo (el cliente paga menos que el total exacto): 1.210 se cobra 1.200 y 2.315 se cobra 2.300.
insert into t_s select 'V5', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'), jsonb_build_array(pg_temp.it('U21', 1)), pg_temp.debit(1200))).id;
insert into t_s select 'V6', (public.register_sale(gen_random_uuid(), pg_temp.sid('S1'),
  jsonb_build_array(pg_temp.it('U21', 1), pg_temp.it('U10', 1)), pg_temp.debit(2300))).id;
reset role;

-- La caja con el ambiente en off sigue igual: las ventas anteriores se hicieron sin ningún documento fiscal.
select is((select count(*)::int from public.fiscal_documents), 0, 'con el ambiente en off, vender no crea documentos fiscales');

-- ---------------------------------------------------------------------------
-- Permisos de las funciones
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fiscal\_%'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'las funciones fiscales solo las ejecuta service_role (ni authenticated ni anon)'
);
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fiscal\_%'
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  5, 'las cinco funciones fiscales son SECURITY DEFINER con search_path vacío'
);
select is(
  (select count(*)::int from unnest(array['select', 'insert', 'update', 'delete']) as op
    where has_table_privilege('authenticated', 'private.fiscal_tickets', op) or has_table_privilege('anon', 'private.fiscal_tickets', op)),
  0, 'authenticated y anon no tienen ningún permiso sobre la tabla de tickets de ARCA'
);

set local role authenticated;
select throws_ok($$select public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V1'), 'invoice', 6::smallint, 0, gen_random_uuid())$$,
  '42501', null, 'authenticated no ejecuta fiscal_begin');
select throws_ok($$select public.fiscal_ticket_get('homologacion', 'wsfe')$$, '42501', null, 'authenticated no lee el ticket de ARCA');
reset role;
set local role anon;
select throws_ok($$select public.fiscal_begin(gen_random_uuid(), gen_random_uuid(), 'invoice', 6::smallint, 0, gen_random_uuid())$$,
  '42501', null, 'anon no ejecuta fiscal_begin');
reset role;

-- Con el ambiente en off no se puede empezar un comprobante.
set local role service_role;
select throws_ok(
  $$select public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V1'), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f1')$$,
  'P0001', 'FISCAL_DISABLED', 'ambiente off -> FISCAL_DISABLED'
);
reset role;

-- ---------------------------------------------------------------------------
-- Configuración: solo el dueño y el programador
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
set local role authenticated;
select is((select environment from public.fiscal_settings), 'off', 'la empleada lee la configuración fiscal (la caja necesita saber si factura)');
update public.fiscal_settings set environment = 'homologacion', pto_vta = 11;
reset role;
select is((select environment from public.fiscal_settings), 'off', 'la empleada no puede cambiar el ambiente');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
update public.fiscal_settings set environment = 'homologacion', pto_vta = 11;
reset role;
select is((select environment from public.fiscal_settings), 'off', 'el encargado tampoco: la configuración fiscal es del dueño');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.fiscal_settings), 0, 'un usuario inactivo no lee la configuración');
reset role;
set local role anon;
select throws_ok($$select * from public.fiscal_settings$$, '42501', null, 'anon no lee la configuración fiscal');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$update public.fiscal_settings set environment = 'homologacion'$$, '23514', null, 'un ambiente sin punto de venta se rechaza');
select throws_ok($$update public.fiscal_settings set environment = 'cualquiera', pto_vta = 11$$, '23514', null, 'ambiente inválido se rechaza');
select throws_ok($$update public.fiscal_settings set environment = 'homologacion', pto_vta = 0$$, '23514', null, 'punto de venta 0 se rechaza');
select throws_ok($$update public.fiscal_settings set environment = 'homologacion', pto_vta = 11, caea_pto_vta = 11$$, '23514', null,
  'el punto de venta de CAEA no puede ser el mismo');
select throws_ok($$update public.fiscal_settings set environment = 'produccion', pto_vta = 11$$, 'P0001', 'PRODUCTION_NOT_READY',
  'no se pasa a producción sin un comprobante autorizado antes en homologación');
select lives_ok($$update public.fiscal_settings set environment = 'homologacion', pto_vta = 11$$, 'el dueño activa homologación');
reset role;
select is((select environment || ':' || pto_vta from public.fiscal_settings), 'homologacion:11', 'ambiente homologación con punto de venta 11');
select ok((select count(*) from public.audit_log where table_name = 'fiscal_settings' and action = 'update') >= 1, 'el cambio de ambiente quedó en audit_log');

-- ---------------------------------------------------------------------------
-- fiscal_begin y fiscal_finish
-- ---------------------------------------------------------------------------
set local role service_role;
insert into t_d select 'F1', (public.fiscal_begin('11111111-1111-4111-8111-111111111111', pg_temp.vid('V1'), 'invoice', 6::smallint, 0,
  '00000000-0000-4000-8000-0000000000f2')).id;
reset role;
select results_eq(
  $$select status, cbte_tipo, pto_vta, cbte_nro, environment, imp_total, imp_neto, imp_iva, receiver_doc_type, receiver_doc_number, receiver_vat_condition_id
    from public.fiscal_documents where id = pg_temp.did('F1')$$,
  $$values ('pending'::text, 6::smallint, 11, 1::bigint, 'homologacion'::text, 1210.00::numeric, 1000.00::numeric, 210.00::numeric, 99::smallint, '0'::text, 5::smallint)$$,
  'F1: factura B pendiente, número 1, importes iguales a los de la venta, consumidor final'
);
select is(
  (select iva_breakdown from public.fiscal_documents where id = pg_temp.did('F1')),
  '[{"id": 5, "rate": 21.00, "base": 1000.00, "amount": 210.00}]'::jsonb,
  'F1: IVA por alícuota (21 % = id 5)'
);

-- Reintento con la misma clave: el mismo documento; otra venta con esa clave: conflicto.
set local role service_role;
select is((select id from public.fiscal_begin('11111111-1111-4111-8111-111111111111', pg_temp.vid('V1'), 'invoice', 6::smallint, 0,
  '00000000-0000-4000-8000-0000000000f2')), pg_temp.did('F1'), 'misma clave y misma venta -> el mismo documento');
select throws_ok(
  $$select public.fiscal_begin('11111111-1111-4111-8111-111111111111', pg_temp.vid('V2'), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f2')$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'misma clave con otra venta -> IDEMPOTENCY_CONFLICT'
);
select is((select id from public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V1'), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f2')),
  pg_temp.did('F1'), 'otra clave sobre la misma venta con comprobante vivo -> se retoma el mismo, no se duplica');
reset role;
select is((select count(*)::int from public.fiscal_documents where sale_id = pg_temp.vid('V1')), 1, 'una venta tiene un solo comprobante vivo');

-- Venta mixta: 21 % y 10,5 %. El número sigue al último de ARCA (si ARCA ya va por el 7, este es el 8).
set local role service_role;
insert into t_d select 'F2', (public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V2'), 'invoice', 6::smallint, 7, '00000000-0000-4000-8000-0000000000f2')).id;
reset role;
select is((select cbte_nro from public.fiscal_documents where id = pg_temp.did('F2')), 8::bigint, 'F2: el número es el último autorizado de ARCA + 1');
select is(
  (select iva_breakdown from public.fiscal_documents where id = pg_temp.did('F2')),
  '[{"id": 4, "rate": 10.50, "base": 1000.00, "amount": 105.00}, {"id": 5, "rate": 21.00, "base": 1000.00, "amount": 210.00}]'::jsonb,
  'F2: dos alícuotas (10,5 % = id 4 y 21 % = id 5)'
);
select is((select imp_total + 0 from public.fiscal_documents where id = pg_temp.did('F2')), 2315.00::numeric, 'F2: total de la venta mixta');

-- Si ARCA va atrasado respecto de lo ya reservado aquí, gana lo reservado (no se repite un número en vuelo).
set local role service_role;
insert into t_d select 'F3', (public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V3'), 'invoice', 6::smallint, 2, '00000000-0000-4000-8000-0000000000f2')).id;
reset role;
select is((select cbte_nro from public.fiscal_documents where id = pg_temp.did('F3')), 9::bigint, 'F3: el número sigue al mayor ya reservado (8 + 1), no al de ARCA');

-- Cerrar el documento.
set local role service_role;
select is((select status from public.fiscal_finish(pg_temp.did('F1'), 'authorized', '86461234567890', date '2026-11-27',
  '{"cbte": 1}'::jsonb, '{"resultado": "A"}'::jsonb)), 'authorized', 'F1 se autoriza con CAE');
reset role;
select results_eq(
  $$select cae, cae_expires_on, authorized_at is not null from public.fiscal_documents where id = pg_temp.did('F1')$$,
  $$values ('86461234567890'::text, date '2026-11-27', true)$$,
  'F1: CAE, vencimiento y fecha de autorización guardados'
);

-- Autorizado = inmutable (incluso para el rol con todos los permisos).
select throws_ok($$update public.fiscal_documents set cae = '99999999999999' where id = pg_temp.did('F1')$$, 'P0001', 'FISCAL_DOCUMENT_IMMUTABLE',
  'un documento autorizado no se modifica');
select throws_ok($$update public.fiscal_documents set imp_total = 5, imp_neto = 5, imp_iva = 0 where id = pg_temp.did('F1')$$, 'P0001', 'FISCAL_DOCUMENT_IMMUTABLE',
  'ni sus importes');
select throws_ok($$delete from public.fiscal_documents where id = pg_temp.did('F1')$$, null, null, 'un documento no se borra');
select throws_ok(
  $$update public.fiscal_documents set cbte_nro = 77 where id = pg_temp.did('F2')$$, 'P0001', 'FISCAL_DOCUMENT_IMMUTABLE',
  'ni siquiera un pendiente cambia su número u otros datos fuera de la respuesta de ARCA'
);

-- Estados: pending -> unknown -> authorized, y rejected es final.
set local role service_role;
select is((select status from public.fiscal_finish(pg_temp.did('F2'), 'unknown', null, null, '{"cbte": 8}'::jsonb, null,
  '[{"code": "TIMEOUT", "msg": "sin respuesta"}]'::jsonb)), 'unknown', 'sin respuesta de ARCA: el documento queda unknown');
select is((select status from public.fiscal_finish(pg_temp.did('F2'), 'authorized', '86461234567891', date '2026-11-27', null,
  '{"resultado": "A"}'::jsonb)), 'authorized', 'unknown -> authorized tras consultar a ARCA');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F2'), 'pending')$$, 'P0001', 'INVALID_FISCAL_TRANSITION', 'no se vuelve a pending');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F2'), 'rejected')$$, 'P0001', 'FISCAL_DOCUMENT_IMMUTABLE', 'authorized no pasa a rejected');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F3'), 'authorized')$$, '23514', null, 'authorized sin CAE se rechaza');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F3'), 'authorized', '123', date '2026-11-27')$$, '23514', null, 'CAE de menos de 14 dígitos se rechaza');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F3'), 'rejected', null, null, '{"token": "x"}'::jsonb)$$, '23514', null,
  'un token de ARCA nunca se guarda en el documento');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F3'), 'rejected', null, null, null, '{"Sign": "x"}'::jsonb)$$, '23514', null,
  'ni una firma en la respuesta');
select is((select status from public.fiscal_finish(pg_temp.did('F3'), 'rejected', null, null, '{"cbte": 9}'::jsonb, '{"resultado": "R"}'::jsonb,
  '[{"code": "10016", "msg": "prueba"}]'::jsonb)), 'rejected', 'F3 queda rechazado con la observación');
select throws_ok($$select public.fiscal_finish(pg_temp.did('F3'), 'authorized', '86461234567892', date '2026-11-27')$$, 'P0001', 'FISCAL_DOCUMENT_IMMUTABLE',
  'un rechazado es final');
select throws_ok($$select public.fiscal_finish(gen_random_uuid(), 'rejected')$$, 'P0001', 'INVALID_FISCAL_DOCUMENT', 'documento inexistente');
reset role;

-- Un rechazado no consumió el número: la venta se puede volver a facturar y reusa el 9.
set local role service_role;
insert into t_d select 'F3b', (public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V3'), 'invoice', 6::smallint, 8, '00000000-0000-4000-8000-0000000000f2')).id;
reset role;
select is((select cbte_nro from public.fiscal_documents where id = pg_temp.did('F3b')), 9::bigint, 'tras un rechazo, el nuevo comprobante reusa el número');
select is((select count(*)::int from public.fiscal_documents where sale_id = pg_temp.vid('V3')), 2, 'el rechazado se conserva como historial');

-- El comprobante lleva lo COBRADO (total + redondeo), con el IVA recalculado por alícuota (contrato §22.4, P-66).
select is((select rounding_amount from public.sales where id = pg_temp.vid('V5')), -10.00::numeric, 'V5: se cobró 1.200 de 1.210 (redondeo −10)');
set local role service_role;
insert into t_d select 'R1', (public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V5'), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f2')).id;
insert into t_d select 'R2', (public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V6'), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f2')).id;
reset role;
select results_eq(
  $$select imp_total, imp_neto, imp_iva, iva_breakdown from public.fiscal_documents where id = pg_temp.did('R1')$$,
  $$values (1200.00::numeric, 991.74::numeric, 208.26::numeric, '[{"id": 5, "rate": 21.00, "base": 991.74, "amount": 208.26}]'::jsonb)$$,
  'R1: la factura es por 1.200 (lo cobrado), con neto 991,74 e IVA 208,26'
);
select results_eq(
  $$select imp_total, imp_neto, imp_iva, iva_breakdown from public.fiscal_documents where id = pg_temp.did('R2')$$,
  $$values (2300.00::numeric, 1987.04::numeric, 312.96::numeric,
    '[{"id": 4, "rate": 10.50, "base": 993.52, "amount": 104.32}, {"id": 5, "rate": 21.00, "base": 993.52, "amount": 208.64}]'::jsonb)$$,
  'R2: 2.300 cobrados repartidos entre 10,5 % y 21 %, con la suma exacta al centavo'
);
select is((select imp_neto + imp_iva from public.fiscal_documents where id = pg_temp.did('R2')), 2300.00::numeric, 'R2: neto + IVA = lo cobrado');
select is(
  (select imp_total from public.fiscal_documents where id = pg_temp.did('F1')), 1210.00::numeric,
  'una venta cobrada exacta (sin redondeo) sigue facturándose por su total'
);

-- Reserva atómica del envío: solo una llamada envía el comprobante a ARCA (contrato §22.3).
set local role service_role;
select is(public.fiscal_claim(pg_temp.did('R1')), true, 'fiscal_claim: la primera llamada reserva el envío');
select is(public.fiscal_claim(pg_temp.did('R1')), false, 'la segunda no: ya se reservó (solo uno envía)');
reset role;
select isnt((select sent_at from public.fiscal_documents where id = pg_temp.did('R1')), null, 'sent_at queda registrado');
select is((select status from public.fiscal_documents where id = pg_temp.did('R1')), 'pending', 'reservar no cambia el estado');
select throws_ok($$update public.fiscal_documents set sent_at = now() + interval '1 hour' where id = pg_temp.did('R1')$$,
  'P0001', 'FISCAL_DOCUMENT_IMMUTABLE', 'sent_at no se vuelve a cambiar');
set local role service_role;
select is((select status from public.fiscal_finish(pg_temp.did('R1'), 'authorized', '86461234567800', date '2026-11-27')),
  'authorized', 'tras reservar, el documento se cierra normalmente');
select is(public.fiscal_claim(pg_temp.did('R1')), false, 'un documento ya autorizado no se reserva');
select is(public.fiscal_claim(gen_random_uuid()), false, 'documento inexistente: false');
reset role;
set local role authenticated;
select throws_ok($$select public.fiscal_claim(gen_random_uuid())$$, '42501', null, 'authenticated no ejecuta fiscal_claim');
reset role;

-- ---------------------------------------------------------------------------
-- Reglas del propio documento (como superusuario: valen para cualquier escritor)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
    values (pg_temp.vid('V4'), 'invoice', 6, 11, 50, 'homologacion', 1000, 900, 100, '[]', gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2')$$,
  'P0001', 'FISCAL_AMOUNT_MISMATCH', 'importes distintos de los de la venta -> FISCAL_AMOUNT_MISMATCH'
);
select throws_ok(
  $$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
    values (pg_temp.vid('V4'), 'invoice', 6, 11, 50, 'produccion', 1105, 1000, 105, '[{"id": 4, "rate": 10.5, "base": 1000, "amount": 105}]', gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2')$$,
  'P0001', 'FISCAL_DISABLED', 'un documento de otro ambiente que el vigente se rechaza'
);
select throws_ok(
  $$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, status, cae, cae_expires_on, authorized_at, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
    values (pg_temp.vid('V4'), 'invoice', 6, 11, 51, 'homologacion', 'authorized', '86461234567893', date '2026-11-27', now(), 1105, 1000, 105, '[{"id": 4, "rate": 10.5, "base": 1000, "amount": 105}]', gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2')$$,
  'P0001', 'INVALID_FISCAL_DOCUMENT', 'un documento solo nace pendiente'
);
select throws_ok(
  $$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
    values (pg_temp.vid('V4'), 'invoice', 6, 11, 8, 'homologacion', 1105, 1000, 105, '[{"id": 4, "rate": 10.5, "base": 1000, "amount": 105}]', gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2')$$,
  '23505', null, 'un número ya usado en el mismo punto de venta y tipo se rechaza'
);
select throws_ok(
  $$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
    values (pg_temp.vid('V4'), 'invoice', 3, 11, 60, 'homologacion', 1105, 1000, 105, '[{"id": 4, "rate": 10.5, "base": 1000, "amount": 105}]', gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2')$$,
  '23514', null, 'una factura con código de nota de crédito se rechaza'
);
select throws_ok(
  $$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, receiver_doc_type, receiver_doc_number, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
    values (pg_temp.vid('V4'), 'invoice', 6, 11, 61, 'homologacion', 99, '12345678', 1105, 1000, 105, '[{"id": 4, "rate": 10.5, "base": 1000, "amount": 105}]', gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2')$$,
  '23514', null, 'consumidor final sin identificar lleva documento 0'
);

-- ---------------------------------------------------------------------------
-- Venta anulada, nota de crédito y anulación con factura
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.void_sale(gen_random_uuid(), pg_temp.vid('V1'), 'Prueba de anulación con factura')$$,
  'P0001', 'FISCAL_DOCUMENT_EXISTS', 'no se anula una venta con factura autorizada y sin nota de crédito'
);
reset role;
select is((select status::text from public.sales where id = pg_temp.vid('V1')), 'completed', 'la venta sigue completada');

set local role service_role;
select throws_ok(
  $$select public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V3'), 'credit_note', 8::smallint, 0, '00000000-0000-4000-8000-0000000000f2', 99::smallint, '0', 5::smallint, pg_temp.did('F3b'))$$,
  'P0001', 'INVALID_FISCAL_DOCUMENT', 'una nota de crédito sobre una factura no autorizada se rechaza'
);
select throws_ok(
  $$select public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V1'), 'credit_note', 3::smallint, 0, '00000000-0000-4000-8000-0000000000f2', 99::smallint, '0', 5::smallint, pg_temp.did('F1'))$$,
  'P0001', 'INVALID_FISCAL_DOCUMENT', 'la nota de crédito A no corresponde a una factura B'
);
insert into t_d select 'N1', (public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V1'), 'credit_note', 8::smallint, 0,
  '00000000-0000-4000-8000-0000000000f1', 99::smallint, '0', 5::smallint, pg_temp.did('F1'))).id;
reset role;
select results_eq(
  $$select kind, cbte_tipo, cbte_nro, original_document_id = pg_temp.did('F1'), imp_total from public.fiscal_documents where id = pg_temp.did('N1')$$,
  $$values ('credit_note'::text, 8::smallint, 1::bigint, true, 1210.00::numeric)$$,
  'N1: nota de crédito B asociada a la factura, con su propia numeración y el importe de la venta'
);

-- Con la nota de crédito pendiente todavía no se puede anular; con ella autorizada, sí.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.void_sale(gen_random_uuid(), pg_temp.vid('V1'), 'Prueba con nota de crédito pendiente')$$,
  'P0001', 'FISCAL_DOCUMENT_EXISTS', 'con la nota de crédito sin autorizar todavía no se anula');
reset role;
set local role service_role;
select is((select status from public.fiscal_finish(pg_temp.did('N1'), 'authorized', '86461234567899', date '2026-11-27')), 'authorized', 'N1 se autoriza');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
select is((select status::text from public.void_sale(gen_random_uuid(), pg_temp.vid('V1'), 'Anulación con nota de crédito')), 'voided',
  'con la nota de crédito autorizada, la venta se anula (y el stock vuelve)');
-- Una venta sin comprobante se anula como siempre.
select is((select status::text from public.void_sale(gen_random_uuid(), pg_temp.vid('V4'), 'Venta sin factura')), 'voided', 'una venta sin factura se anula como siempre');
reset role;
set local role service_role;
select throws_ok(
  $$select public.fiscal_begin(gen_random_uuid(), pg_temp.vid('V4'), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f2')$$,
  'P0001', 'SALE_VOIDED', 'no se factura una venta anulada'
);
select throws_ok(
  $$select public.fiscal_begin(gen_random_uuid(), gen_random_uuid(), 'invoice', 6::smallint, 0, '00000000-0000-4000-8000-0000000000f2')$$,
  'P0001', 'SALE_NOT_FOUND', 'venta inexistente'
);
reset role;

-- ---------------------------------------------------------------------------
-- Producción: recién con un comprobante autorizado en homologación
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f4", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$update public.fiscal_settings set environment = 'produccion', pto_vta = 11$$, 'el programador puede pasar a producción habiendo homologado');
reset role;
select is((select environment from public.fiscal_settings), 'produccion', 'ambiente producción');
-- (se vuelve a homologación para el resto de la prueba)
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}', true);
set local role authenticated;
update public.fiscal_settings set environment = 'homologacion';
reset role;

-- ---------------------------------------------------------------------------
-- Lectura de los comprobantes
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.fiscal_documents) >= 5, 'el encargado ve todos los comprobantes');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.fiscal_documents), (select count(*)::int from public.fiscal_documents where sale_id in (select id from public.sales where created_by = '00000000-0000-4000-8000-0000000000f2')),
  'la empleada ve los comprobantes de las ventas que cobró');
select ok((select count(*) from public.fiscal_documents) > 0, 'y son varios');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f6", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.fiscal_documents), 0, 'otra empleada no ve comprobantes de ventas ajenas');
reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.fiscal_documents), 0, 'un usuario inactivo no ve comprobantes (aunque su rol sea encargado)');
select throws_ok($$insert into public.fiscal_documents (sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, imp_total, imp_neto, imp_iva, iva_breakdown, idempotency_key, created_by)
  values (gen_random_uuid(), 'invoice', 6, 11, 99, 'homologacion', 1, 1, 0, '[]', gen_random_uuid(), gen_random_uuid())$$, '42501', null,
  'authenticated no inserta comprobantes');
reset role;
set local role anon;
select throws_ok($$select * from public.fiscal_documents$$, '42501', null, 'anon no lee comprobantes');
reset role;
select ok((select count(*) from public.audit_log where table_name = 'fiscal_documents' and action = 'insert') >= 1, 'la creación de comprobantes queda en audit_log');
select is(
  (select count(*)::int from public.audit_log where table_name = 'fiscal_documents'
     and (new_data::text ilike '%"token"%' or new_data::text ilike '%"sign"%')),
  0, 'ningún token ni firma quedó en la auditoría'
);

-- ---------------------------------------------------------------------------
-- Ticket de acceso de ARCA
-- ---------------------------------------------------------------------------
set local role service_role;
select is((select count(*)::int from public.fiscal_ticket_get('homologacion', 'wsfe')), 0, 'sin ticket guardado: no hay nada que devolver');
select lives_ok(
  $$select public.fiscal_ticket_save('homologacion', 'wsfe', 'TOKEN-FICTICIO', 'SIGN-FICTICIO', now() - interval '1 minute', now() + interval '12 hours')$$,
  'se guarda el ticket'
);
select is((select token from public.fiscal_ticket_get('homologacion', 'wsfe')), 'TOKEN-FICTICIO', 'se recupera el ticket vigente');
select lives_ok(
  $$select public.fiscal_ticket_save('homologacion', 'wsfe', 'TOKEN-2', 'SIGN-2', now() - interval '1 minute', now() + interval '12 hours')$$,
  'se reemplaza (un ticket por ambiente y servicio)'
);
select is((select token from public.fiscal_ticket_get('homologacion', 'wsfe')), 'TOKEN-2', 'el reemplazo quedó');
select is((select count(*)::int from public.fiscal_ticket_get('produccion', 'wsfe')), 0, 'los ambientes no se mezclan');
select lives_ok(
  $$select public.fiscal_ticket_save('homologacion', 'wsfe', 'VENCIDO', 'SIGN', now() - interval '13 hours', now() + interval '90 seconds')$$,
  'se guarda uno por vencer'
);
select is((select count(*)::int from public.fiscal_ticket_get('homologacion', 'wsfe')), 0, 'un ticket que vence en menos de 2 minutos no se devuelve (hay que pedir otro)');
reset role;

-- Conciliación: ningún comprobante de esta prueba con importes distintos de los de su venta.
select is(
  (select count(*)::int from public.fiscal_documents d join public.sales s on s.id = d.sale_id
    where d.imp_total <> s.total_amount + s.rounding_amount
       or d.imp_neto + d.imp_iva <> d.imp_total),
  0, 'todos los comprobantes son por lo cobrado y su neto más su IVA da ese importe'
);
select is(
  (select count(*)::int from public.fiscal_documents where status = 'authorized' and cae !~ '^[0-9]{14}$'),
  0, 'todo comprobante autorizado tiene un CAE de 14 dígitos'
);

select * from finish();
rollback;
