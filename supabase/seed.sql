-- Datos de demostración para el entorno LOCAL (se cargan con `supabase db reset`).
-- Todo es ficticio: nombres, marcas, proveedor, códigos y cantidades.
-- Nunca correr esto en producción.
--
-- No crea usuarios para ingresar: eso lo hace `npm run db:users` con la
-- contraseña de .env.test.local (que no se sube a Git).
--
-- Las fechas son relativas a hoy (Argentina), así siempre hay lotes vencidos,
-- urgentes, por vencer y en regla para ver las alertas.
--
-- Nombres e IDs elegidos para no chocar con los de supabase/tests.

-- ---------------------------------------------------------------------------
-- Usuario técnico de la carga: queda inactivo y sin contraseña (no puede
-- ingresar). Las RPC exigen un encargado activo y registran su autoría.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values ('5eed0000-0000-4000-8000-000000000001', 'carga-inicial@zahuy.test', '{"full_name": "Carga inicial (demo)"}');
update public.profiles set role = 'manager' where id = '5eed0000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub": "5eed0000-0000-4000-8000-000000000001", "role": "authenticated"}', false);

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
insert into public.categories (id, name) values
  ('5eed0000-0000-4000-8000-0000000000c1', 'Lácteos y frescos'),
  ('5eed0000-0000-4000-8000-0000000000c2', 'Limpieza y hogar'),
  ('5eed0000-0000-4000-8000-0000000000c3', 'Bebidas'),
  ('5eed0000-0000-4000-8000-0000000000c4', 'Almacén seco'),
  ('5eed0000-0000-4000-8000-0000000000c5', 'Fiambrería');

insert into public.brands (id, name) values
  ('5eed0000-0000-4000-8000-0000000000b1', 'Granja del Sur'),
  ('5eed0000-0000-4000-8000-0000000000b2', 'Brillo Hogar'),
  ('5eed0000-0000-4000-8000-0000000000b3', 'Río Claro'),
  ('5eed0000-0000-4000-8000-0000000000b4', 'Molino Norte');

insert into public.suppliers (id, name, phone, notes) values
  ('5eed0000-0000-4000-8000-0000000000d1', 'Mayorista Demo SRL', '000-0000', 'Proveedor ficticio de demostración');

-- Limpieza vence en años: alertas más tempranas que el resto.
insert into public.expiry_alert_settings (category_id, notice_days, soon_days, urgent_days)
values ('5eed0000-0000-4000-8000-0000000000c2', 90, 60, 30);

-- ---------------------------------------------------------------------------
-- Productos y lotes (por RPC, como lo haría la app)
-- ---------------------------------------------------------------------------
create temporary table seed_products (key text primary key, id uuid);

do $$
declare
  v_today date := private.today_ar();
begin
  -- Yogur: un lote urgente y otro en regla.
  insert into seed_products select 'yogur', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001001', p_name => 'Yogur bebible frutilla 1 L',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c1', p_brand_id => '5eed0000-0000-4000-8000-0000000000b1',
    p_supplier_id => '5eed0000-0000-4000-8000-0000000000d1', p_barcode => '2000000000011',
    p_sale_unit => 'unit', p_cost_price => 800, p_sale_price => 1000, p_vat_rate => 21, p_min_stock => 10,
    p_boxes_quantity => 2, p_units_per_box => 12,
    p_initial_quantity => 30, p_received_on => v_today - 10, p_expires_on => v_today + 5, p_batch_number => 'GS-0101')).id;
  perform public.receive_stock('5eed0000-0000-4000-8000-000000002001', (select id from seed_products where key = 'yogur'),
    36, v_today - 1, v_today + 40, 'GS-0102', 'Remito demo 0001');

  -- Leche: un lote vencido (para descartar) y uno por vencer.
  insert into seed_products select 'leche', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001002', p_name => 'Leche entera sachet 1 L',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c1', p_brand_id => '5eed0000-0000-4000-8000-0000000000b1',
    p_supplier_id => '5eed0000-0000-4000-8000-0000000000d1', p_barcode => '2000000000028',
    p_sale_unit => 'unit', p_cost_price => 900, p_sale_price => 1150, p_vat_rate => 10.5, p_min_stock => 24,
    p_initial_quantity => 6, p_received_on => v_today - 20, p_expires_on => v_today - 3, p_batch_number => 'GS-0201')).id;
  perform public.receive_stock('5eed0000-0000-4000-8000-000000002002', (select id from seed_products where key = 'leche'),
    48, v_today - 2, v_today + 12, 'GS-0202', null);

  -- Queso por kilo, con decimales.
  insert into seed_products select 'queso', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001003', p_name => 'Queso cremoso por kg',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c5', p_brand_id => '5eed0000-0000-4000-8000-0000000000b1',
    p_sale_unit => 'kg', p_cost_price => 7000, p_sale_price => 9500, p_vat_rate => 21, p_min_stock => 2,
    p_boxes_quantity => 0, p_units_per_box => 1,
    p_initial_quantity => 8.5, p_received_on => v_today - 5, p_expires_on => v_today + 25, p_batch_number => null)).id;

  -- Lavandina: vence en un año y medio; stock bajo el mínimo.
  insert into seed_products select 'lavandina', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001004', p_name => 'Lavandina 2 L',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c2', p_brand_id => '5eed0000-0000-4000-8000-0000000000b2',
    p_barcode => '2000000000035',
    p_sale_unit => 'unit', p_cost_price => 1100, p_sale_price => 1600, p_vat_rate => 21, p_min_stock => 12,
    p_initial_quantity => 8, p_received_on => v_today - 30, p_expires_on => v_today + 540, p_batch_number => 'BH-77')).id;

  -- Detergente: dentro de la alerta de limpieza (60 días).
  insert into seed_products select 'detergente', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001005', p_name => 'Detergente limón 750 ml',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c2', p_brand_id => '5eed0000-0000-4000-8000-0000000000b2',
    p_sale_unit => 'unit', p_cost_price => 1300, p_sale_price => 1900, p_vat_rate => 21, p_min_stock => 6,
    p_boxes_quantity => 1, p_units_per_box => 12,
    p_initial_quantity => 18, p_received_on => v_today - 200, p_expires_on => v_today + 45, p_batch_number => null)).id;

  -- Agua en pack de 6: varias cajas.
  insert into seed_products select 'agua', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001006', p_name => 'Agua mineral sin gas 2 L',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c3', p_brand_id => '5eed0000-0000-4000-8000-0000000000b3',
    p_barcode => '2000000000042',
    p_sale_unit => 'unit', p_cost_price => 600, p_sale_price => 900, p_vat_rate => 21, p_min_stock => 12,
    p_boxes_quantity => 5, p_units_per_box => 6,
    p_initial_quantity => 40, p_received_on => v_today - 3, p_expires_on => v_today + 300, p_batch_number => 'RC-2026')).id;

  -- Fideos: en regla.
  insert into seed_products select 'fideos', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001007', p_name => 'Fideos tirabuzón 500 g',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c4', p_brand_id => '5eed0000-0000-4000-8000-0000000000b4',
    p_supplier_id => '5eed0000-0000-4000-8000-0000000000d1',
    p_sale_unit => 'unit', p_cost_price => 700, p_sale_price => 1050, p_vat_rate => 21, p_min_stock => 10,
    p_initial_quantity => 60, p_received_on => v_today - 15, p_expires_on => v_today + 400, p_batch_number => null)).id;

  -- Producto nuevo, todavía sin stock.
  insert into seed_products select 'arroz', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001008', p_name => 'Arroz largo fino 1 kg',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c4', p_brand_id => '5eed0000-0000-4000-8000-0000000000b4',
    p_sale_unit => 'unit', p_cost_price => 1200, p_sale_price => 1700, p_vat_rate => 21, p_min_stock => 10)).id;

  -- Producto inactivo (discontinuado).
  insert into seed_products select 'jugo', (public.create_product(
    p_idempotency_key => '5eed0000-0000-4000-8000-000000001009', p_name => 'Jugo en polvo naranja (discontinuado)',
    p_category_id => '5eed0000-0000-4000-8000-0000000000c3', p_brand_id => '5eed0000-0000-4000-8000-0000000000b3',
    p_sale_unit => 'unit', p_cost_price => 150, p_sale_price => 250, p_vat_rate => 21, p_is_active => false)).id;

  -- ---------------------------------------------------------------------------
  -- Movimientos de ejemplo
  -- ---------------------------------------------------------------------------
  perform public.register_product_movement('5eed0000-0000-4000-8000-000000003001', (select id from seed_products where key = 'yogur'),
    'exit', 12, null, 'Salida de ejemplo');
  perform public.register_product_movement('5eed0000-0000-4000-8000-000000003002', (select id from seed_products where key = 'fideos'),
    'internal_use', 2, 'Degustación', null);
  perform public.register_product_movement('5eed0000-0000-4000-8000-000000003003', (select id from seed_products where key = 'queso'),
    'exit', 1.25, null, null);
  perform public.register_product_movement('5eed0000-0000-4000-8000-000000003004', (select id from seed_products where key = 'agua'),
    'damage', 1, 'Botella rota en góndola', null);
  perform public.register_product_movement('5eed0000-0000-4000-8000-000000003005', (select id from seed_products where key = 'lavandina'),
    'customer_return', 1, 'Cliente devolvió sin abrir', null);
end;
$$;

drop table seed_products;

-- El usuario técnico queda inactivo: no puede operar ni ingresar.
select set_config('request.jwt.claims', '', false);
update public.profiles set is_active = false where id = '5eed0000-0000-4000-8000-000000000001';
