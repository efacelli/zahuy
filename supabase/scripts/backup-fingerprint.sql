-- Huella de los datos: cantidad de filas y un resumen (md5) por tabla.
-- Ver docs/DEPLOY.md, sección "Backups y recuperación".
--
-- Solo lee; no modifica nada. Se corre con un rol privilegiado (ve todas las
-- filas) en dos momentos:
--   1. al hacer el backup, guardando la salida junto a los archivos;
--   2. después de restaurar, comparando contra esa salida.
-- Si las dos salidas son iguales, la restauración trajo exactamente los mismos
-- datos. No imprime ningún dato del negocio: solo conteos y resúmenes.
--
-- "descuadres" tiene que ser 0: es la conciliación del stock (saldo de cada
-- lote = suma de sus movimientos, contrato §3).
select 'audit_log' as tabla, count(*) as filas,
       md5(coalesce(string_agg(id::text || table_name || action || changed_at::text, '|' order by id), '')) as resumen
from public.audit_log
union all
select 'auth.users', count(*), md5(coalesce(string_agg(id::text || coalesce(email, ''), '|' order by id), ''))
from auth.users
union all
select 'brands', count(*), md5(coalesce(string_agg(id::text || name || is_active::text || created_at::text, '|' order by id), ''))
from public.brands
union all
select 'categories', count(*), md5(coalesce(string_agg(id::text || name || is_active::text || created_at::text, '|' order by id), ''))
from public.categories
union all
select 'descuadres',
       (select count(*) from public.product_batches b
         where b.quantity_available is distinct from
           (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
       ''
union all
select 'expiry_alert_settings', count(*),
       md5(coalesce(string_agg(id::text || urgent_days || soon_days || notice_days, '|' order by id), ''))
from public.expiry_alert_settings
union all
select 'product_batches', count(*),
       md5(coalesce(string_agg(
         id::text || quantity_initial || quantity_available || coalesce(expires_on::text, '') || created_at::text
           || coalesce(updated_by::text, ''), '|' order by id), ''))
from public.product_batches
union all
select 'products', count(*),
       md5(coalesce(string_agg(
         id::text || sku || name || cost_price || sale_price || sale_price_with_vat || coalesce(created_by::text, '')
           || created_at::text || updated_at::text, '|' order by id), ''))
from public.products
union all
select 'products_sku_seq', (select last_value from public.products_sku_seq), ''
union all
select 'profiles', count(*), md5(coalesce(string_agg(id::text || role || is_active::text || full_name, '|' order by id), ''))
from public.profiles
union all
select 'stock_movements', count(*),
       md5(coalesce(string_agg(
         id::text || movement_type || quantity || signed_quantity || batch_quantity_after || created_by::text
           || created_at::text || coalesce(reverses_movement_id::text, ''), '|' order by id), ''))
from public.stock_movements
union all
select 'suppliers', count(*), md5(coalesce(string_agg(id::text || name || is_active::text, '|' order by id), ''))
from public.suppliers
order by 1;
