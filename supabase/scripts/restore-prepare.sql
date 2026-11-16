-- Paso previo para restaurar un backup de datos en un proyecto NUEVO.
-- Ver docs/DEPLOY.md, sección "Backups y recuperación".
--
-- Por qué hace falta: en un proyecto recién creado, las migraciones ya dejan
-- algunas filas propias (la configuración general de alertas, su registro de
-- auditoría, los medios de pago, las cajas, la configuración de ventas y el bucket de imágenes). El backup de datos trae esas mismas
-- filas con los valores de producción. Si no se quitan antes, la carga de esas
-- tablas falla ENTERA por clave duplicada y se pierden, sin aviso visible, toda
-- la auditoría y las alertas por categoría.
--
-- Qué hace: borra SOLO las filas que crean las migraciones, y solo si la base
-- está vacía de datos del negocio. Si encuentra datos del negocio, se detiene
-- sin tocar nada: este script no es para una base en uso.
--
-- Seguro por defecto ante tablas nuevas: la lista de abajo (v_seeded) nombra las
-- tablas de public en las que una migración deja filas propias. TODA OTRA tabla
-- de public cuenta como "datos del negocio": si tiene filas, el script se
-- detiene. Así, una tabla nueva (ventas, caja...) nunca se borra por error; y si
-- una migración futura siembra filas en una tabla nueva (por ejemplo los medios
-- de pago), el script se detiene y avisa en vez de dejar que la restauración
-- pierda datos en silencio. En ese caso: agregar la tabla a v_seeded.
--
-- Uso (con una conexión de rol privilegiado al proyecto NUEVO):
--   1. aplicar las migraciones (db push);
--   2. correr ESTE archivo;
--   3. cargar el backup de datos;
--   4. verificar con backup-fingerprint.sql (docs/DEPLOY.md).

begin;

do $$
declare
  -- Tablas de public donde las migraciones siembran filas (se vacían antes de restaurar).
  v_seeded text[] := array['audit_log', 'expiry_alert_settings', 'payment_methods', 'cash_registers', 'sales_settings'];
  v_table text;
  v_rows bigint;
  v_found text := '';
begin
  -- Usuarios de Auth y archivos de Storage también son datos del negocio.
  select count(*) into v_rows from auth.users;
  if v_rows > 0 then v_found := v_found || format(' auth.users=%s', v_rows); end if;
  select count(*) into v_rows from storage.objects;
  if v_rows > 0 then v_found := v_found || format(' storage.objects=%s', v_rows); end if;

  for v_table in
    select tablename from pg_tables
    where schemaname = 'public' and not (tablename = any (v_seeded))
    order by tablename
  loop
    execute format('select count(*) from public.%I', v_table) into v_rows;
    if v_rows > 0 then v_found := v_found || format(' %s=%s', v_table, v_rows); end if;
  end loop;

  if v_found <> '' then
    raise exception
      'RESTORE_PREPARE_ABORTED: la base no está vacía (%). No se modificó nada.', btrim(v_found)
      using hint = 'Este script solo se usa en un proyecto nuevo, antes de cargar un backup. Si una migración nueva siembra filas en una tabla, agregarla a v_seeded.';
  end if;
end;
$$;

-- Los triggers de solo-agregado y de protección no dejan borrar estas filas.
-- En modo réplica no se ejecutan; vale solo dentro de esta transacción.
set local session_replication_role = replica;

delete from public.audit_log;
delete from public.expiry_alert_settings;
delete from public.payment_methods;
delete from public.cash_registers;
delete from public.sales_settings;
-- Los buckets los crean las migraciones; el backup trae los suyos. Storage está
-- vacío (se comprobó arriba), así que no se pierde ningún archivo.
delete from storage.buckets;

commit;
