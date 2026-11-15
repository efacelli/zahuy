-- Paso previo para restaurar un backup de datos en un proyecto NUEVO.
-- Ver docs/DEPLOY.md, sección "Backups y recuperación".
--
-- Por qué hace falta: en un proyecto recién creado, las migraciones ya dejan
-- algunas filas propias (la configuración general de alertas, su registro de
-- auditoría y el bucket de imágenes). El backup de datos trae esas mismas
-- filas con los valores de producción. Si no se quitan antes, la carga de esas
-- tablas falla ENTERA por clave duplicada y se pierden, sin aviso visible, toda
-- la auditoría y las alertas por categoría.
--
-- Qué hace: borra SOLO las filas que crean las migraciones, y solo si la base
-- está vacía de datos del negocio. Si encuentra usuarios, productos, lotes o
-- movimientos, se detiene sin tocar nada: este script no es para una base en
-- uso.
--
-- Uso (con una conexión de rol privilegiado al proyecto NUEVO):
--   1. aplicar las migraciones (db push);
--   2. correr ESTE archivo;
--   3. cargar el backup de datos;
--   4. verificar conteos y conciliación (consultas en docs/DEPLOY.md).

begin;

do $$
declare
  v_users bigint;
  v_products bigint;
  v_batches bigint;
  v_movements bigint;
begin
  select count(*) into v_users from auth.users;
  select count(*) into v_products from public.products;
  select count(*) into v_batches from public.product_batches;
  select count(*) into v_movements from public.stock_movements;

  if v_users + v_products + v_batches + v_movements > 0 then
    raise exception
      'RESTORE_PREPARE_ABORTED: la base no está vacía (usuarios=%, productos=%, lotes=%, movimientos=%). No se modificó nada.',
      v_users, v_products, v_batches, v_movements
      using hint = 'Este script solo se usa en un proyecto nuevo, antes de cargar un backup.';
  end if;
end;
$$;

-- Los triggers de solo-agregado y de protección no dejan borrar estas filas.
-- En modo réplica no se ejecutan; vale solo dentro de esta transacción.
set local session_replication_role = replica;

delete from public.audit_log;
delete from public.expiry_alert_settings;
delete from storage.buckets where id = 'product-images';

commit;
