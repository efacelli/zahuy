-- Paso E: lotes, movimientos (append-only), conciliación y auditoría.
-- Contrato v0.3.1 §3, §5.5–5.8, §9 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_table('public', 'product_batches', 'existe product_batches');
select has_table('public', 'stock_movements', 'existe stock_movements');
select has_table('public', 'audit_log', 'existe audit_log');
select col_type_is('public', 'product_batches', 'quantity_available', 'numeric(12,3)', 'saldo numeric(12,3)');
select col_type_is('public', 'stock_movements', 'quantity', 'numeric(12,3)', 'cantidad numeric(12,3)');
select hasnt_column('public', 'stock_movements', 'updated_at', 'stock_movements no tiene updated_at');
select hasnt_column('public', 'stock_movements', 'updated_by', 'stock_movements no tiene updated_by');
select fk_ok(
  'public', 'stock_movements', array['batch_id', 'product_id'],
  'public', 'product_batches', array['id', 'product_id'],
  'FK compuesta lote/producto'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'todas las tablas de public tienen RLS activada'
);

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000003a', 'ana.admin@zahuy.test'),
  ('00000000-0000-4000-8000-00000000003b', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-00000000003c', 'ines.inactiva@zahuy.test');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000003a';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-00000000003c';

insert into public.categories (id, name) values ('00000000-0000-4000-8000-0000000003c1', 'Fiambres de prueba');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-0000000003b1', 'Marca de prueba E');
insert into public.products (id, sku, name, category_id, brand_id, sale_unit, cost_price, sale_price) values
  ('00000000-0000-4000-8000-0000000003e1', 'E-LECHE', 'Leche de prueba', '00000000-0000-4000-8000-0000000003c1',
   '00000000-0000-4000-8000-0000000003b1', 'unit', 800, 1200),
  ('00000000-0000-4000-8000-0000000003e2', 'E-QUESO', 'Queso de prueba', '00000000-0000-4000-8000-0000000003c1',
   '00000000-0000-4000-8000-0000000003b1', 'kg', 5000, 8000),
  ('00000000-0000-4000-8000-0000000003e3', 'E-SINMOV', 'Sin movimientos', '00000000-0000-4000-8000-0000000003c1',
   '00000000-0000-4000-8000-0000000003b1', 'unit', 1, 2);

-- Simulan lo que harán las RPC: lote + movimiento en la misma transacción.
create function pg_temp.add_batch(p_id uuid, p_product uuid, p_qty numeric, p_expires date default null)
returns void language plpgsql as $$
begin
  set constraints all deferred;
  insert into public.product_batches (id, product_id, expires_on, quantity_initial, quantity_available)
  values (p_id, p_product, p_expires, p_qty, p_qty);
  insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
  values (gen_random_uuid(), p_product, p_id, 'entry', p_qty, p_qty, '00000000-0000-4000-8000-00000000003b');
  set constraints all immediate;
end;
$$;

create function pg_temp.move(p_batch uuid, p_type public.movement_type, p_qty numeric, p_reason text default null)
returns uuid language plpgsql as $$
declare
  v_after numeric;
  v_product uuid;
  v_id uuid;
begin
  set constraints all deferred;
  update public.product_batches
  set quantity_available = quantity_available
    + case when p_type in ('entry', 'adjustment_in', 'customer_return') then p_qty else -p_qty end
  where id = p_batch
  returning quantity_available, product_id into v_after, v_product;
  insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, reason, created_by)
  values (gen_random_uuid(), v_product, p_batch, p_type, p_qty, v_after, p_reason, '00000000-0000-4000-8000-00000000003b')
  returning id into v_id;
  set constraints all immediate;
  return v_id;
end;
$$;

-- Devuelve 'ok' o el SQLSTATE de una sentencia, sin abortar la transacción.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  set constraints all immediate;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

select lives_ok(
  $$select pg_temp.add_batch('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003e1', 10, date '2027-06-30')$$,
  'lote con su movimiento de ingreso'
);
select lives_ok(
  $$select pg_temp.add_batch('00000000-0000-4000-8000-0000000003f2', '00000000-0000-4000-8000-0000000003e2', 2.500)$$,
  'lote sin vencimiento y con decimales (kg)'
);
select lives_ok(
  $$select pg_temp.move('00000000-0000-4000-8000-0000000003f1', 'shrinkage', 3, 'Envases rotos')$$,
  'salida por merma'
);

select results_eq(
  $$select movement_type, quantity, signed_quantity, batch_quantity_after
    from public.stock_movements where batch_id = '00000000-0000-4000-8000-0000000003f1' order by batch_quantity_after desc$$,
  $$values ('entry'::public.movement_type, 10.000::numeric(12,3), 10.000::numeric(12,3), 10.000::numeric(12,3)),
           ('shrinkage'::public.movement_type, 3.000::numeric(12,3), -3.000::numeric(12,3), 7.000::numeric(12,3))$$,
  'la cantidad es positiva y el signo sale del tipo'
);
select is(
  (select received_on from public.product_batches where id = '00000000-0000-4000-8000-0000000003f1'),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  'received_on por defecto es hoy en Buenos Aires'
);

-- ---------------------------------------------------------------------------
-- Conciliación: saldo del lote = suma del ledger
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0,
  'todos los lotes concilian con sus movimientos'
);
select is(
  pg_temp.try($$insert into public.product_batches (product_id, quantity_initial, quantity_available)
    values ('00000000-0000-4000-8000-0000000003e1', 5, 5)$$),
  '23514',
  'un lote sin movimiento de ingreso se rechaza'
);
select is(
  pg_temp.try($$update public.product_batches set quantity_available = 99 where id = '00000000-0000-4000-8000-0000000003f1'$$),
  '23514',
  'cambiar el saldo sin movimiento se rechaza'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'exit', 1, 6,
            '00000000-0000-4000-8000-00000000003b')$$),
  '23514',
  'un movimiento sin actualizar el saldo se rechaza'
);
select is(
  (select quantity_available from public.product_batches where id = '00000000-0000-4000-8000-0000000003f1'),
  7.000::numeric(12,3),
  'los intentos rechazados no cambiaron el saldo'
);

-- ---------------------------------------------------------------------------
-- Restricciones de movimientos
-- ---------------------------------------------------------------------------
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e2', '00000000-0000-4000-8000-0000000003f1', 'exit', 1, 6,
            '00000000-0000-4000-8000-00000000003b')$$),
  '23503',
  'lote de otro producto: lo rechaza la FK compuesta'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'exit', 0, 7,
            '00000000-0000-4000-8000-00000000003b')$$),
  '23514', 'cantidad cero'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'exit', -2, 7,
            '00000000-0000-4000-8000-00000000003b')$$),
  '23514', 'cantidad negativa'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'damage', 1, 6,
            '00000000-0000-4000-8000-00000000003b')$$),
  '23514', 'daño sin motivo'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, reason, created_by)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'adjustment_out', 1, 6, '   ',
            '00000000-0000-4000-8000-00000000003b')$$),
  '23514', 'ajuste con motivo en blanco'
);
select is(
  pg_temp.try($$update public.product_batches set quantity_available = -1 where id = '00000000-0000-4000-8000-0000000003f1'$$),
  '23514', 'saldo negativo'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
    select idempotency_key, product_id, batch_id, 'exit', 1, 6, created_by
    from public.stock_movements where batch_id = '00000000-0000-4000-8000-0000000003f1' limit 1$$),
  '23505', 'idempotency_key repetida'
);

-- Un movimiento se revierte una sola vez (índice único).
create temporary table t_ids on commit drop as
select pg_temp.move('00000000-0000-4000-8000-0000000003f1', 'exit', 2) as exit_id;

select lives_ok(
  $t$do $do$
  begin
    set constraints all deferred;
    update public.product_batches set quantity_available = quantity_available + 2
      where id = '00000000-0000-4000-8000-0000000003f1';
    insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, reason, reverses_movement_id, created_by)
    select gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'adjustment_in', 2, 7,
           'Salida cargada por error', exit_id, '00000000-0000-4000-8000-00000000003b' from t_ids;
    set constraints all immediate;
  end $do$ $t$,
  'movimiento compensatorio con reverses_movement_id'
);
select is(
  pg_temp.try($$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, reason, reverses_movement_id, created_by)
    select gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'adjustment_in', 2, 9,
           'Otra vez', exit_id, '00000000-0000-4000-8000-00000000003b' from t_ids$$),
  '23505', 'revertir dos veces el mismo movimiento'
);

-- ---------------------------------------------------------------------------
-- Append-only: ni un rol privilegiado edita o borra el historial
-- ---------------------------------------------------------------------------
select is(pg_temp.try($$update public.stock_movements set quantity = 1$$), '42501', 'UPDATE de movimientos rechazado');
select is(pg_temp.try($$delete from public.stock_movements$$), '42501', 'DELETE de movimientos rechazado');
select is(pg_temp.try($$truncate public.stock_movements$$), '42501', 'TRUNCATE de movimientos rechazado');
select is(
  pg_temp.try($$update public.product_batches set quantity_initial = 50 where id = '00000000-0000-4000-8000-0000000003f1'$$),
  '23514', 'quantity_initial no se modifica'
);
select is(
  pg_temp.try($$update public.product_batches set product_id = '00000000-0000-4000-8000-0000000003e3' where id = '00000000-0000-4000-8000-0000000003f1'$$),
  '23514', 'product_id del lote no se modifica'
);
select is(
  pg_temp.try($$delete from public.product_batches where id = '00000000-0000-4000-8000-0000000003f1'$$),
  '23503', 'un lote con movimientos no se puede borrar'
);
select is(
  pg_temp.try($$delete from public.products where id = '00000000-0000-4000-8000-0000000003e1'$$),
  '23503', 'un producto con lotes no se puede borrar'
);

-- ---------------------------------------------------------------------------
-- Unidad de venta
-- ---------------------------------------------------------------------------
select is(
  pg_temp.try($$update public.products set sale_unit = 'unit' where id = '00000000-0000-4000-8000-0000000003e2'$$),
  '23514', 'no se cambia sale_unit de un producto con movimientos'
);
select is(
  pg_temp.try($$update public.products set sale_unit = 'pack' where id = '00000000-0000-4000-8000-0000000003e3'$$),
  'ok', 'sí se cambia sale_unit de un producto sin movimientos'
);
select is(
  pg_temp.try($$update public.products set sale_price = 8500 where id = '00000000-0000-4000-8000-0000000003e2'$$),
  'ok', 'el resto del producto con movimientos se sigue editando'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.product_batches$$, '42501', null, 'anon no lee lotes');
select throws_ok($$select * from public.stock_movements$$, '42501', null, 'anon no lee movimientos');
select throws_ok($$select * from public.audit_log$$, '42501', null, 'anon no lee auditoría');
reset role;

-- ---------------------------------------------------------------------------
-- Empleada activa
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000003b", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from public.product_batches where product_id = '00000000-0000-4000-8000-0000000003e1'),
  1, 'lee los lotes'
);
select is(
  (select count(*)::int from public.stock_movements where product_id = '00000000-0000-4000-8000-0000000003e1'),
  4, 'lee los movimientos'
);
select is((select count(*)::int from public.audit_log), 0, 'una empleada no lee la auditoría');

select throws_ok(
  $$insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1', 'entry', 100, 107)$$,
  '42501', null, 'no inserta movimientos de forma directa'
);
select throws_ok($$update public.stock_movements set quantity = 1$$, '42501', null, 'no edita movimientos');
select throws_ok($$delete from public.stock_movements$$, '42501', null, 'no borra movimientos');
select throws_ok(
  $$insert into public.product_batches (product_id, quantity_initial, quantity_available)
    values ('00000000-0000-4000-8000-0000000003e1', 5, 5)$$,
  '42501', null, 'no crea lotes de forma directa'
);
select throws_ok(
  $$update public.product_batches set quantity_available = 1000 where id = '00000000-0000-4000-8000-0000000003f1'$$,
  '42501', null, 'no escribe el saldo del lote'
);
select throws_ok(
  $$update public.product_batches set quantity_initial = 1000 where id = '00000000-0000-4000-8000-0000000003f1'$$,
  '42501', null, 'no escribe la cantidad inicial'
);
select throws_ok($$delete from public.product_batches$$, '42501', null, 'no borra lotes');
select lives_ok(
  $$update public.product_batches set batch_number = 'L-2027-06', expires_on = date '2027-07-15', notes = 'Corregido contra el envase'
    where id = '00000000-0000-4000-8000-0000000003f1'$$,
  'sí corrige número de lote, vencimiento y observaciones'
);
select lives_ok(
  $$update public.products set sale_price = 1300 where id = '00000000-0000-4000-8000-0000000003e1'$$,
  'cambia un precio'
);
select lives_ok(
  $$update public.products set sale_price = 1300 where id = '00000000-0000-4000-8000-0000000003e1'$$,
  'repite el mismo precio (edición sin cambios)'
);
select throws_ok(
  $$insert into public.audit_log (table_name, record_id, action) values ('products', gen_random_uuid(), 'update')$$,
  '42501', null, 'nadie escribe la auditoría desde la app'
);
reset role;

-- ---------------------------------------------------------------------------
-- Usuario inactivo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000003c", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.product_batches), 0, 'inactivo no lee lotes');
select is((select count(*)::int from public.stock_movements), 0, 'inactivo no lee movimientos');
select is((select count(*)::int from public.audit_log), 0, 'inactivo no lee auditoría');
reset role;

-- ---------------------------------------------------------------------------
-- Auditoría (la lee el admin)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000003a", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$select action, changed_by, (old_data ->> 'sale_price')::numeric, (new_data ->> 'sale_price')::numeric
    from public.audit_log
    where table_name = 'products' and record_id = '00000000-0000-4000-8000-0000000003e1' and action = 'update'$$,
  $$values ('update', '00000000-0000-4000-8000-00000000003b'::uuid, 1200::numeric, 1300::numeric)$$,
  'el cambio de precio queda auditado una sola vez, con autor, valor anterior y nuevo'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'products' and record_id = '00000000-0000-4000-8000-0000000003e1' and action = 'insert'),
  1,
  'el alta del producto queda auditada'
);
select results_eq(
  $$select new_data ->> 'batch_number', new_data ->> 'expires_on', old_data ->> 'expires_on', changed_by
    from public.audit_log
    where table_name = 'product_batches' and record_id = '00000000-0000-4000-8000-0000000003f1'$$,
  $$values ('L-2027-06', '2027-07-15', '2027-06-30', '00000000-0000-4000-8000-00000000003b'::uuid)$$,
  'la corrección del lote queda auditada; los cambios de saldo no generan filas'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'categories' and record_id = '00000000-0000-4000-8000-0000000003c1'),
  1,
  'el alta de una categoría queda auditada'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'profiles' and record_id = '00000000-0000-4000-8000-00000000003a' and action = 'update'
      and new_data ->> 'role' = 'admin'),
  1,
  'el cambio de rol queda auditado'
);
reset role;

select is(pg_temp.try($$update public.audit_log set action = 'insert'$$), '42501', 'UPDATE de auditoría rechazado');
select is(pg_temp.try($$delete from public.audit_log$$), '42501', 'DELETE de auditoría rechazado');
select is(pg_temp.try($$truncate public.audit_log$$), '42501', 'TRUNCATE de auditoría rechazado');

-- Conciliación final de todo lo hecho en esta prueba.
select is(
  (select count(*)::int from public.product_batches b
    where b.quantity_available is distinct from
      (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
  0,
  'conciliación final: todos los lotes coinciden con el ledger'
);

select * from finish();
rollback;
