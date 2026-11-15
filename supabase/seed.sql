-- Datos FICTICIOS para probar la app en local. Se cargan con `supabase db reset`.
--
-- Nada de esto es real: nombres, marcas, proveedores, precios y usuarios son
-- inventados. El repositorio es público: no agregar acá datos del negocio.
--
-- Usuarios (uno por rol, más uno inactivo). Se crean SIN contraseña: nadie
-- puede iniciar sesión hasta que cada persona le ponga una en su máquina (ver
-- "Usuarios de prueba" en supabase/README.md). Así no hay ninguna credencial en
-- el repositorio.
--
--   duena@zahuy.test      Dueña      (admin)
--   encargado@zahuy.test  Encargado  (manager)
--   empleada@zahuy.test   Empleada   (staff)
--   inactivo@zahuy.test   Inactivo   (staff, desactivado)
--
-- Los productos, lotes y movimientos se cargan con las mismas RPC que usa la
-- app (create_product, receive_stock, register_product_movement,
-- reverse_stock_movement), con la sesión simulada de cada usuario. Las claves
-- de idempotencia son fijas: volver a correr este archivo no duplica nada.

-- ---------------------------------------------------------------------------
-- 1. Usuarios
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', u.full_name), now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('5eed0000-0000-4000-8000-000000000001'::uuid, 'duena@zahuy.test', 'Dora Dueña (ficticia)'),
  ('5eed0000-0000-4000-8000-000000000002'::uuid, 'encargado@zahuy.test', 'Enzo Encargado (ficticio)'),
  ('5eed0000-0000-4000-8000-000000000003'::uuid, 'empleada@zahuy.test', 'Eva Empleada (ficticia)'),
  ('5eed0000-0000-4000-8000-000000000004'::uuid, 'inactivo@zahuy.test', 'Iván Inactivo (ficticio)')
) as u (id, email, full_name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now()
from auth.users u
where u.email like '%@zahuy.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

-- El trigger ya creó los perfiles como staff. Los roles se asignan acá, con
-- rol privilegiado y sin sesión (igual que se promueve al primer admin).
update public.profiles set role = 'admin' where id = '5eed0000-0000-4000-8000-000000000001' and role <> 'admin';
update public.profiles set role = 'manager' where id = '5eed0000-0000-4000-8000-000000000002' and role <> 'manager';
update public.profiles set is_active = false where id = '5eed0000-0000-4000-8000-000000000004' and is_active;

-- ---------------------------------------------------------------------------
-- 2. Catálogos, productos, lotes y movimientos
-- ---------------------------------------------------------------------------
do $seed$
declare
  c_manager constant uuid := '5eed0000-0000-4000-8000-000000000002';
  c_staff constant uuid := '5eed0000-0000-4000-8000-000000000003';
  v_today date := private.today_ar();
  v_cat_lacteos uuid;
  v_cat_fiambres uuid;
  v_cat_almacen uuid;
  v_cat_bebidas uuid;
  v_cat_limpieza uuid;
  v_brand_vaquita uuid;
  v_brand_cerro uuid;
  v_brand_rio uuid;
  v_brand_brillo uuid;
  v_brand_granja uuid;
  v_sup_norte uuid;
  v_sup_centro uuid;
  v_leche uuid;
  v_yogur uuid;
  v_queso uuid;
  v_jamon uuid;
  v_fideos uuid;
  v_arroz uuid;
  v_agua uuid;
  v_gaseosa uuid;
  v_lavandina uuid;
  v_detergente uuid;
  v_galletitas uuid;
  v_discontinuado uuid;
  v_movement_id uuid;

  -- Sesión simulada: las RPC y los triggers toman al usuario de acá.
  -- (declarada como bloque interno más abajo)
begin
  perform set_config('request.jwt.claims', json_build_object('sub', c_manager, 'role', 'authenticated')::text, true);

  -- Catálogos (como encargado, para que queden a su nombre).
  insert into public.categories (name)
  select n from unnest(array['Lácteos', 'Fiambres', 'Almacén', 'Bebidas', 'Limpieza']) n
  where not exists (select 1 from public.categories c where lower(private.unaccent_text(trim(c.name))) = lower(private.unaccent_text(n)));
  insert into public.brands (name)
  select n from unnest(array['La Vaquita Ficticia', 'Cerro Inventado', 'Río Imaginario', 'Brillo de Mentira', 'Granja de Prueba']) n
  where not exists (select 1 from public.brands b where lower(private.unaccent_text(trim(b.name))) = lower(private.unaccent_text(n)));
  insert into public.suppliers (name, phone, email, notes)
  select s.name, s.phone, s.email, s.notes
  from (values
    ('Distribuidora Ficticia del Norte', '000 000-0001', 'ventas@norte.ficticio.test', 'Proveedor inventado. Entrega los martes.'),
    ('Mayorista Inventado del Centro', '000 000-0002', 'pedidos@centro.ficticio.test', 'Proveedor inventado. Entrega los viernes.')
  ) as s (name, phone, email, notes)
  where not exists (select 1 from public.suppliers x where lower(private.unaccent_text(trim(x.name))) = lower(private.unaccent_text(s.name)));

  select id into v_cat_lacteos from public.categories where name = 'Lácteos';
  select id into v_cat_fiambres from public.categories where name = 'Fiambres';
  select id into v_cat_almacen from public.categories where name = 'Almacén';
  select id into v_cat_bebidas from public.categories where name = 'Bebidas';
  select id into v_cat_limpieza from public.categories where name = 'Limpieza';
  select id into v_brand_vaquita from public.brands where name = 'La Vaquita Ficticia';
  select id into v_brand_cerro from public.brands where name = 'Cerro Inventado';
  select id into v_brand_rio from public.brands where name = 'Río Imaginario';
  select id into v_brand_brillo from public.brands where name = 'Brillo de Mentira';
  select id into v_brand_granja from public.brands where name = 'Granja de Prueba';
  select id into v_sup_norte from public.suppliers where name = 'Distribuidora Ficticia del Norte';
  select id into v_sup_centro from public.suppliers where name = 'Mayorista Inventado del Centro';

  -- Los lácteos avisan antes: 3 / 7 / 15 días en lugar de 7 / 15 / 30.
  insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
  select v_cat_lacteos, 3, 7, 15
  where not exists (select 1 from public.expiry_alert_settings s where s.category_id = v_cat_lacteos);

  -- Productos (precios sin IVA). El SKU lo asigna la base.
  v_leche := (public.create_product('5eed0001-0000-4000-8000-000000000001', 'Leche entera 1 l', v_cat_lacteos, v_brand_vaquita,
    'unit', 820, 1150, 21, p_barcode => '7791234500011', p_supplier_id => v_sup_norte, p_boxes_quantity => 3,
    p_units_per_box => 12, p_min_stock => 24)).id;
  v_yogur := (public.create_product('5eed0001-0000-4000-8000-000000000002', 'Yogur bebible frutilla 900 g', v_cat_lacteos, v_brand_vaquita,
    'unit', 1400, 1950, 21, p_supplier_id => v_sup_norte, p_units_per_box => 6, p_min_stock => 10)).id;
  v_queso := (public.create_product('5eed0001-0000-4000-8000-000000000003', 'Queso cremoso', v_cat_lacteos, v_brand_granja,
    'kg', 5200, 7900, 21, p_supplier_id => v_sup_norte, p_min_stock => 3)).id;
  v_jamon := (public.create_product('5eed0001-0000-4000-8000-000000000004', 'Jamón cocido', v_cat_fiambres, v_brand_granja,
    'kg', 7800, 11500, 10.5, p_supplier_id => v_sup_centro, p_min_stock => 2)).id;
  v_fideos := (public.create_product('5eed0001-0000-4000-8000-000000000005', 'Fideos tirabuzón 500 g', v_cat_almacen, v_brand_cerro,
    'unit', 620, 890, 21, p_barcode => '7791234500059', p_supplier_id => v_sup_centro, p_boxes_quantity => 5,
    p_units_per_box => 12, p_min_stock => 20)).id;
  v_arroz := (public.create_product('5eed0001-0000-4000-8000-000000000006', 'Arroz largo fino 1 kg', v_cat_almacen, v_brand_cerro,
    'unit', 980, 1390, 10.5, p_supplier_id => v_sup_centro, p_boxes_quantity => 8, p_units_per_box => 10, p_min_stock => 15)).id;
  v_agua := (public.create_product('5eed0001-0000-4000-8000-000000000007', 'Agua mineral 1,5 l', v_cat_bebidas, v_brand_rio,
    'unit', 430, 650, 21, p_supplier_id => v_sup_norte, p_boxes_quantity => 4, p_units_per_box => 6, p_min_stock => 30)).id;
  v_gaseosa := (public.create_product('5eed0001-0000-4000-8000-000000000008', 'Gaseosa cola 2,25 l', v_cat_bebidas, v_brand_rio,
    'unit', 1500, 2100, 21, p_supplier_id => v_sup_norte, p_units_per_box => 8, p_min_stock => 16)).id;
  v_lavandina := (public.create_product('5eed0001-0000-4000-8000-000000000009', 'Lavandina 1 l', v_cat_limpieza, v_brand_brillo,
    'unit', 540, 800, 21, p_supplier_id => v_sup_centro, p_units_per_box => 15, p_min_stock => 10)).id;
  v_detergente := (public.create_product('5eed0001-0000-4000-8000-00000000000a', 'Detergente limón 750 ml', v_cat_limpieza, v_brand_brillo,
    'unit', 890, 1290, 21, p_min_stock => 8)).id;
  v_galletitas := (public.create_product('5eed0001-0000-4000-8000-00000000000b', 'Galletitas de agua pack x3', v_cat_almacen, v_brand_cerro,
    'pack', 1100, 1600, 21, p_supplier_id => v_sup_centro, p_min_stock => 5)).id;
  v_discontinuado := (public.create_product('5eed0001-0000-4000-8000-00000000000c', 'Jugo en polvo naranja (discontinuado)', v_cat_bebidas, v_brand_rio,
    'unit', 150, 240, 21, p_min_stock => 0)).id;

  -- Ingresos de mercadería. Fechas relativas a hoy, para que siempre haya
  -- lotes vencidos, urgentes, próximos y vigentes.
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000001', v_leche, 36, v_today - 6, v_today + 2, 'L-LE-01', 'Remito ficticio 0001');
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000002', v_leche, 48, v_today - 1, v_today + 12, 'L-LE-02', 'Remito ficticio 0007');
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000003', v_yogur, 12, v_today - 7, v_today - 1, 'L-YO-01', 'Remito ficticio 0002');
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000004', v_yogur, 18, v_today - 2, v_today + 6, 'L-YO-02', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000005', v_queso, 8.5, v_today - 4, v_today + 20, null, 'Horma entera');
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000006', v_jamon, 4.25, v_today - 3, v_today, 'L-JA-01', 'Vence hoy');
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000007', v_jamon, 6, v_today - 1, v_today + 25, 'L-JA-02', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000008', v_fideos, 84, v_today - 5, v_today + 400, 'L-FI-01', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-000000000009', v_arroz, 60, v_today - 5, v_today + 300, 'L-AR-01', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-00000000000a', v_agua, 24, v_today - 2, v_today + 180, 'L-AG-01', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-00000000000b', v_gaseosa, 40, v_today - 2, v_today + 28, 'L-GA-01', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-00000000000c', v_lavandina, 30, v_today - 6, v_today + 700, 'L-LA-01', null);
  perform public.receive_stock('5eed0002-0000-4000-8000-00000000000d', v_galletitas, 6, v_today - 3, v_today + 90, null, null);
  perform public.receive_stock('5eed0002-0000-4000-8000-00000000000e', v_discontinuado, 9, v_today - 6, v_today + 45, null, null);
  -- "Detergente limón" queda sin lotes: producto sin stock.

  -- Movimientos del encargado.
  perform public.register_product_movement('5eed0003-0000-4000-8000-000000000001', v_yogur, 'shrinkage', 8, 'Parte del lote vencido, descartada');
  perform public.register_product_movement('5eed0003-0000-4000-8000-000000000002', v_leche, 'exit', 40, null, 'Salida que toma de dos lotes');
  perform public.register_product_movement('5eed0003-0000-4000-8000-000000000003', v_agua, 'damage', 2, 'Botellas pinchadas');
  perform public.register_product_movement('5eed0003-0000-4000-8000-000000000004', v_arroz, 'adjustment_out', 1, 'Recuento: faltaba uno');
  -- Una salida cargada por error y su anulación.
  select m.id into v_movement_id
  from public.register_product_movement('5eed0003-0000-4000-8000-000000000005', v_fideos, 'exit', 5) m
  limit 1;
  perform public.reverse_stock_movement('5eed0003-0000-4000-8000-000000000006', v_movement_id, 'Salida cargada por error');
  -- El producto discontinuado se desactiva; su stock se puede dar de baja igual.
  update public.products set is_active = false where id = v_discontinuado and is_active;

  -- Movimientos de la empleada: un ingreso, consumo interno y un conteo de cajas.
  perform set_config('request.jwt.claims', json_build_object('sub', c_staff, 'role', 'authenticated')::text, true);
  perform public.receive_stock('5eed0004-0000-4000-8000-000000000001', v_gaseosa, 16, v_today, v_today + 60, 'L-GA-02', 'Cargado por la empleada');
  perform public.register_product_movement('5eed0004-0000-4000-8000-000000000002', v_queso, 'internal_use', 0.3, 'Degustación en el local');
  -- 8 cajas de 10 son más que el stock de arroz: queda marcado para revisar el conteo.
  update public.products set boxes_quantity = 8 where id = v_arroz;

  perform set_config('request.jwt.claims', '', true);
end;
$seed$;
