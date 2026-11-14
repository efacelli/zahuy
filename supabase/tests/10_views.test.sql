-- v0.4 paso F: vistas v_batch_status, v_product_stock, v_product_list y
-- v_inventory_summary. Contrato v0.4.2 §4.4, §7 y §12. Solo datos ficticios.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Estructura y seguridad de las vistas
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c
    where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace
      and c.relname in ('v_batch_status', 'v_product_stock', 'v_product_list', 'v_inventory_summary')
      and c.reloptions @> array['security_invoker=true']),
  4, 'las cuatro vistas usan security_invoker = true'
);
select is(
  (select count(*)::int from pg_class c
    where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  0, 'no hay ninguna vista en public sin security_invoker'
);

-- Columnas que consume el frontend (list-api.ts, alerts-api.ts, dashboard-api.ts).
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_product_list'
      and column_name in (
        'id', 'sku', 'barcode', 'name', 'category_id', 'category_name', 'brand_id', 'brand_name', 'supplier_id',
        'supplier_name', 'sale_unit', 'cost_price', 'sale_price', 'sale_price_with_vat', 'vat_rate', 'boxes_quantity',
        'units_per_box', 'min_stock', 'is_active', 'stock_quantity', 'next_expires_on', 'next_expiry_status',
        'active_batches_count', 'is_low_stock', 'units_in_boxes', 'loose_units', 'has_box_mismatch')),
  27, 'v_product_list tiene las 27 columnas que pide el listado'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_batch_status'
      and column_name in (
        'id', 'product_id', 'product_sku', 'product_name', 'product_is_active', 'sale_unit', 'category_id',
        'category_name', 'batch_number', 'received_on', 'expires_on', 'quantity_available', 'days_to_expiry',
        'expiry_status')),
  14, 'v_batch_status tiene las 14 columnas que pide Alertas'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_inventory_summary'
      and column_name in (
        'active_products', 'low_stock_products', 'expiring_products', 'expired_batches', 'stock_value_cost',
        'stock_value_sale', 'shrinkage_quantity_month', 'box_mismatch_products')),
  8, 'v_inventory_summary tiene las 8 columnas del dashboard'
);
select col_type_is('public', 'v_product_stock', 'stock_quantity', 'numeric(12,3)', 'stock_quantity es numeric(12,3)');
select col_type_is('public', 'v_product_stock', 'next_expiry_status', 'expiry_status', 'next_expiry_status es expiry_status');
select col_type_is('public', 'v_batch_status', 'days_to_expiry', 'integer', 'days_to_expiry es integer');
select col_type_is('public', 'v_inventory_summary', 'stock_value_cost', 'numeric(14,2)', 'stock_value_cost es numeric(14,2)');
select col_type_is('public', 'v_inventory_summary', 'shrinkage_quantity_month', 'numeric(14,3)', 'shrinkage_quantity_month es numeric(14,3)');

-- Regla de estados, sin depender de la fecha (hoy = 2026-06-10, días 7/15/30).
select is(private.expiry_status_for(date '2026-06-01', 0, date '2026-06-10', 7, 15, 30), 'depleted', 'agotado gana aunque esté vencido');
select is(private.expiry_status_for(null, 5, date '2026-06-10', 7, 15, 30), 'no_expiry', 'sin vencimiento');
select is(private.expiry_status_for(date '2026-06-09', 5, date '2026-06-10', 7, 15, 30), 'expired', 'venció ayer');
select is(private.expiry_status_for(date '2026-06-10', 5, date '2026-06-10', 7, 15, 30), 'expires_urgent', 'vence hoy: urgente, no vencido');
select is(private.expiry_status_for(date '2026-06-17', 5, date '2026-06-10', 7, 15, 30), 'expires_urgent', 'vence en 7 días');
select is(private.expiry_status_for(date '2026-06-18', 5, date '2026-06-10', 7, 15, 30), 'expires_soon', 'vence en 8 días');
select is(private.expiry_status_for(date '2026-06-25', 5, date '2026-06-10', 7, 15, 30), 'expires_soon', 'vence en 15 días');
select is(private.expiry_status_for(date '2026-06-26', 5, date '2026-06-10', 7, 15, 30), 'expires_upcoming', 'vence en 16 días');
select is(private.expiry_status_for(date '2026-07-10', 5, date '2026-06-10', 7, 15, 30), 'expires_upcoming', 'vence en 30 días');
select is(private.expiry_status_for(date '2026-07-11', 5, date '2026-06-10', 7, 15, 30), 'ok', 'vence en 31 días');

-- ---------------------------------------------------------------------------
-- Usuarios y foto inicial del dashboard (para comparar por diferencia)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ab', 'enzo.encargado@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000ac', 'eva.empleada@zahuy.test'),
  ('00000000-0000-4000-8000-0000000000ad', 'ivan.inactivo@zahuy.test');
update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000ab';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000ad';

create temporary table t_summary on commit drop as
select 0 as step, s.* from public.v_inventory_summary s where false;
grant all on t_summary to authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ab", "role": "authenticated"}', true);
set local role authenticated;
insert into t_summary select 1, s.* from public.v_inventory_summary s;
reset role;

select is((select count(*)::int from t_summary where step = 1), 1, 'el encargado recibe una fila del dashboard');

-- ---------------------------------------------------------------------------
-- Datos ficticios
-- ---------------------------------------------------------------------------
-- Categoría con días propios 10 / 20 / 45; la otra usa los generales 7 / 15 / 30.
insert into public.categories (id, name) values
  ('00000000-0000-4000-8000-00000000f0c1', 'Vistas general'),
  ('00000000-0000-4000-8000-00000000f0c2', 'Vistas con días propios');
insert into public.brands (id, name) values ('00000000-0000-4000-8000-00000000f0b1', 'Marca vistas');
insert into public.suppliers (id, name) values ('00000000-0000-4000-8000-00000000f0d1', 'Proveedor vistas');
insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
values ('00000000-0000-4000-8000-00000000f0c2', 10, 20, 45);

insert into public.products
  (id, sku, name, category_id, brand_id, supplier_id, sale_unit, cost_price, sale_price, vat_rate, min_stock, boxes_quantity, units_per_box, is_active)
values
  -- P1: varios lotes; 84 unidades en total, 5 cajas de 12.
  ('00000000-0000-4000-8000-00000000f0e1', 'VIS-001', 'Vistas leche', '00000000-0000-4000-8000-00000000f0c1',
   '00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-00000000f0d1', 'unit', 100, 200, 21, 10, 5, 12, true),
  -- P2: sin lotes.
  ('00000000-0000-4000-8000-00000000f0e2', 'VIS-002', 'Vistas sin lotes', '00000000-0000-4000-8000-00000000f0c1',
   '00000000-0000-4000-8000-00000000f0b1', null, 'unit', 10, 20, 21, 0, 0, 12, true),
  -- P3: solo un lote sin vencimiento (semilla).
  ('00000000-0000-4000-8000-00000000f0e3', 'VIS-003', 'Vistas sin vencimiento', '00000000-0000-4000-8000-00000000f0c1',
   '00000000-0000-4000-8000-00000000f0b1', null, 'kg', 1000, 1500, 10.5, 1, 0, 12, true),
  -- P4: categoría con días propios; vence en 40 días.
  ('00000000-0000-4000-8000-00000000f0e4', 'VIS-004', 'Vistas días propios', '00000000-0000-4000-8000-00000000f0c2',
   '00000000-0000-4000-8000-00000000f0b1', null, 'unit', 50, 80, 21, 2, 8, 12, true),
  -- P5: misma fecha que P4 pero en la categoría general.
  ('00000000-0000-4000-8000-00000000f0e5', 'VIS-005', 'Vistas días generales', '00000000-0000-4000-8000-00000000f0c1',
   '00000000-0000-4000-8000-00000000f0b1', null, 'unit', 50, 80, 21, 100, 0, 12, true),
  -- P6: inactivo, con un lote vencido.
  ('00000000-0000-4000-8000-00000000f0e6', 'VIS-006', 'Vistas inactivo', '00000000-0000-4000-8000-00000000f0c1',
   '00000000-0000-4000-8000-00000000f0b1', null, 'unit', 10, 20, 21, 0, 0, 12, false);

create function pg_temp.add_batch(p_id uuid, p_product uuid, p_qty numeric, p_days integer)
returns void language plpgsql as $$
begin
  set constraints all deferred;
  insert into public.product_batches (id, product_id, expires_on, quantity_initial, quantity_available)
  values (p_id, p_product, case when p_days is null then null else private.today_ar() + p_days end, p_qty, p_qty);
  insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, created_by)
  values (gen_random_uuid(), p_product, p_id, 'entry', p_qty, p_qty, '00000000-0000-4000-8000-0000000000ab');
  set constraints all immediate;
end;
$$;

create function pg_temp.move_out(p_batch uuid, p_type public.movement_type, p_qty numeric)
returns void language plpgsql as $$
declare
  v_after numeric;
  v_product uuid;
begin
  set constraints all deferred;
  update public.product_batches set quantity_available = quantity_available - p_qty
  where id = p_batch returning quantity_available, product_id into v_after, v_product;
  insert into public.stock_movements (idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, reason, created_by)
  values (gen_random_uuid(), v_product, p_batch, p_type, p_qty, v_after, 'Prueba de vistas', '00000000-0000-4000-8000-0000000000ab');
  set constraints all immediate;
end;
$$;

-- P1: vencido (4), vence hoy (10), +8 (20), +16 (30), +31 (20) y uno agotado.
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1a1', '00000000-0000-4000-8000-00000000f0e1', 4, -1);
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1a2', '00000000-0000-4000-8000-00000000f0e1', 10, 0);
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1a3', '00000000-0000-4000-8000-00000000f0e1', 20, 8);
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1a4', '00000000-0000-4000-8000-00000000f0e1', 30, 16);
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1a5', '00000000-0000-4000-8000-00000000f0e1', 20, 31);
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1a6', '00000000-0000-4000-8000-00000000f0e1', 6, -5);
select pg_temp.move_out('00000000-0000-4000-8000-00000000f1a6', 'shrinkage', 6);
-- P3: 2,5 kg sin vencimiento; merma de 0,5 kg.
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1b1', '00000000-0000-4000-8000-00000000f0e3', 3, null);
select pg_temp.move_out('00000000-0000-4000-8000-00000000f1b1', 'damage', 0.5);
-- P4 y P5: vencen en 40 días.
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1c1', '00000000-0000-4000-8000-00000000f0e4', 50, 40);
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1d1', '00000000-0000-4000-8000-00000000f0e5', 50, 40);
-- P6 (inactivo): lote vencido con stock.
select pg_temp.add_batch('00000000-0000-4000-8000-00000000f1e1', '00000000-0000-4000-8000-00000000f0e6', 3, -10);
-- Consumo interno y una salida común (esta última no cuenta como merma).
select pg_temp.move_out('00000000-0000-4000-8000-00000000f1c1', 'internal_use', 2);
select pg_temp.move_out('00000000-0000-4000-8000-00000000f1d1', 'exit', 5);

-- ---------------------------------------------------------------------------
-- Lecturas como encargado
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ab", "role": "authenticated"}', true);
set local role authenticated;

-- v_batch_status
select results_eq(
  $$select quantity_available, days_to_expiry, expiry_status::text
    from public.v_batch_status where product_id = '00000000-0000-4000-8000-00000000f0e1'
    order by expires_on$$,
  $$values (0.000::numeric(12,3), -5, 'depleted'),
           (4.000::numeric(12,3), -1, 'expired'),
           (10.000::numeric(12,3), 0, 'expires_urgent'),
           (20.000::numeric(12,3), 8, 'expires_soon'),
           (30.000::numeric(12,3), 16, 'expires_upcoming'),
           (20.000::numeric(12,3), 31, 'ok')$$,
  'estados de los lotes con los días generales 7 / 15 / 30'
);
select results_eq(
  $$select days_to_expiry, expiry_status::text from public.v_batch_status
    where id = '00000000-0000-4000-8000-00000000f1b1'$$,
  $$values (null::integer, 'no_expiry')$$,
  'lote sin vencimiento: no_expiry y días nulos'
);
select is(
  (select expiry_status::text from public.v_batch_status where id = '00000000-0000-4000-8000-00000000f1c1'),
  'expires_upcoming', 'categoría con 10/20/45: un lote que vence en 40 días es expires_upcoming'
);
select is(
  (select expiry_status::text from public.v_batch_status where id = '00000000-0000-4000-8000-00000000f1d1'),
  'ok', 'categoría general: el mismo vencimiento a 40 días es ok'
);
select results_eq(
  $$select product_sku, product_name, product_is_active, sale_unit::text, category_id, category_name
    from public.v_batch_status where id = '00000000-0000-4000-8000-00000000f1b1'$$,
  $$values ('VIS-003', 'Vistas sin vencimiento', true, 'kg', '00000000-0000-4000-8000-00000000f0c1'::uuid, 'Vistas general')$$,
  'v_batch_status trae los datos del producto y la categoría (v0.4.2)'
);
-- Filtro de la pantalla de Alertas: nunca agotados, sin vencimiento ni vigentes.
select is(
  (select count(*)::int from public.v_batch_status
    where expiry_status in ('expired', 'expires_urgent', 'expires_soon', 'expires_upcoming')
      and product_sku like 'VIS-%'),
  6, 'alertas: 2 vencidos (uno de un producto inactivo), 1 urgente, 1 pronto y 2 próximos'
);

-- v_product_stock
select results_eq(
  $$select stock_quantity, next_expires_on - private.today_ar(), next_expiry_status::text, active_batches_count,
           is_low_stock, units_in_boxes, loose_units, has_box_mismatch
    from public.v_product_stock where product_id = '00000000-0000-4000-8000-00000000f0e1'$$,
  $$values (84.000::numeric(12,3), -1, 'expired', 5, false, 60.000::numeric(12,3), 24.000::numeric(12,3), false)$$,
  'P1: stock 84, próximo vencimiento el lote vencido, 5 lotes con stock; 5 cajas de 12 → 60 en cajas y 24 sueltas'
);
select results_eq(
  $$select stock_quantity, next_expires_on, next_expiry_status, active_batches_count, is_low_stock, has_box_mismatch
    from public.v_product_stock where product_id = '00000000-0000-4000-8000-00000000f0e2'$$,
  $$values (0.000::numeric(12,3), null::date, null::public.expiry_status, 0, true, false)$$,
  'P2 sin lotes: stock 0, sin estado, y stock bajo porque 0 <= mínimo 0'
);
select results_eq(
  $$select stock_quantity, next_expires_on, next_expiry_status::text, active_batches_count, is_low_stock
    from public.v_product_stock where product_id = '00000000-0000-4000-8000-00000000f0e3'$$,
  $$values (2.500::numeric(12,3), null::date, 'no_expiry', 1, false)$$,
  'P3 solo con lote sin vencimiento: no_expiry y stock con decimales'
);
select results_eq(
  $$select stock_quantity, units_in_boxes, loose_units, has_box_mismatch
    from public.v_product_stock where product_id = '00000000-0000-4000-8000-00000000f0e4'$$,
  $$values (48.000::numeric(12,3), 96.000::numeric(12,3), -48.000::numeric(12,3), true)$$,
  'P4: 8 cajas de 12 superan el stock de 48 → has_box_mismatch'
);
select is(
  (select is_low_stock from public.v_product_stock where product_id = '00000000-0000-4000-8000-00000000f0e5'),
  true, 'P5: stock 45 con mínimo 100 → stock bajo'
);

-- v_product_list
select results_eq(
  $$select sku, category_name, brand_name, supplier_name, sale_price, sale_price_with_vat, units_per_box, stock_quantity
    from public.v_product_list where id = '00000000-0000-4000-8000-00000000f0e1'$$,
  $$values ('VIS-001', 'Vistas general', 'Marca vistas', 'Proveedor vistas', 200.00::numeric(12,2), 242.00::numeric(12,2), 12,
            84.000::numeric(12,3))$$,
  'v_product_list une catálogos, precio final y stock'
);
select is(
  (select supplier_name from public.v_product_list where id = '00000000-0000-4000-8000-00000000f0e2'),
  null, 'producto sin proveedor: supplier_name nulo'
);
-- Consulta como la arma el listado: búsqueda, filtros y orden.
select results_eq(
  $$select sku from public.v_product_list
    where (name ilike '%vistas%' or sku ilike '%vistas%' or barcode ilike '%vistas%')
      and category_id = '00000000-0000-4000-8000-00000000f0c1' and is_active and is_low_stock
    order by stock_quantity desc nulls last, name, id$$,
  $$values ('VIS-005'), ('VIS-002')$$,
  'búsqueda + categoría + stock bajo + activos, ordenado por stock'
);
select results_eq(
  $$select sku from public.v_product_list
    where next_expiry_status in ('expires_urgent', 'expires_soon', 'expires_upcoming') and sku like 'VIS-%'
    order by sku$$,
  $$values ('VIS-004')$$,
  'filtro "por vencer": P1 no entra porque su próximo lote ya está vencido'
);
select results_eq(
  $$select sku from public.v_product_list where next_expiry_status in ('expired') and sku like 'VIS-%' order by sku$$,
  $$values ('VIS-001'), ('VIS-006')$$,
  'filtro "vencido"'
);

insert into t_summary select 2, s.* from public.v_inventory_summary s;
reset role;

-- ---------------------------------------------------------------------------
-- v_inventory_summary: diferencias que aportan los datos de esta prueba
-- ---------------------------------------------------------------------------
select results_eq(
  $$select a.active_products - b.active_products,
           a.low_stock_products - b.low_stock_products,
           a.expiring_products - b.expiring_products,
           a.expired_batches - b.expired_batches,
           a.stock_value_cost - b.stock_value_cost,
           a.stock_value_sale - b.stock_value_sale,
           a.shrinkage_quantity_month - b.shrinkage_quantity_month,
           a.box_mismatch_products - b.box_mismatch_products
    from t_summary a, t_summary b where a.step = 2 and b.step = 1$$,
  $$values (5, 2, 1, 2,
            (84 * 100 + 2.5 * 1000 + 48 * 50 + 45 * 50)::numeric,
            (84 * 242 + 2.5 * 1657.50 + 48 * 96.80 + 45 * 96.80)::numeric,
            (6 + 0.5 + 2)::numeric,
            1)$$,
  'dashboard: 5 activos, 2 con stock bajo, 1 por vencer, 2 lotes vencidos, valores a costo y a precio final, mermas del mes y 1 desajuste de cajas'
);

-- ---------------------------------------------------------------------------
-- Empleada: lee listados y alertas, pero no el dashboard
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ac", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.v_product_list where sku like 'VIS-%'), 6, 'empleada lee v_product_list');
select is(
  (select cost_price from public.v_product_list where sku = 'VIS-001'),
  100.00::numeric(12,2), 'empleada ve costos'
);
select is((select count(*)::int from public.v_batch_status where product_sku like 'VIS-%'), 10, 'empleada lee v_batch_status');
select is((select count(*)::int from public.v_product_stock where product_id = '00000000-0000-4000-8000-00000000f0e1'), 1, 'empleada lee v_product_stock');
select is((select count(*)::int from public.v_inventory_summary), 0, 'empleada no recibe filas del dashboard');
reset role;

-- ---------------------------------------------------------------------------
-- Inactivo y anon
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ad", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.v_product_list), 0, 'inactivo no lee v_product_list');
select is((select count(*)::int from public.v_batch_status), 0, 'inactivo no lee v_batch_status');
select is((select count(*)::int from public.v_product_stock), 0, 'inactivo no lee v_product_stock');
select is((select count(*)::int from public.v_inventory_summary), 0, 'inactivo no lee el dashboard');
reset role;

set local role anon;
select throws_ok($$select * from public.v_product_list$$, '42501', null, 'anon no lee v_product_list');
select throws_ok($$select * from public.v_batch_status$$, '42501', null, 'anon no lee v_batch_status');
select throws_ok($$select * from public.v_product_stock$$, '42501', null, 'anon no lee v_product_stock');
select throws_ok($$select * from public.v_inventory_summary$$, '42501', null, 'anon no lee v_inventory_summary');
reset role;

select * from finish();
rollback;
