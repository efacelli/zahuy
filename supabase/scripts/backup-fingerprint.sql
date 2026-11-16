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
-- Cubre SOLA todas las tablas del esquema public (también las que se agreguen en
-- el futuro, como ventas y caja): no hay una lista que mantener. Cada tabla se
-- resume con el md5 de todas sus filas ordenadas por id. Por eso toda tabla de
-- public tiene que tener una columna id (contrato §2.5); si alguna no la tuviera,
-- el script falla a propósito en lugar de omitirla.
--
-- Fecha y zona fija: el resumen incluye fechas, y su texto depende de la zona
-- horaria de la sesión; se fija en UTC para que backup y restauración coincidan.
--
-- "descuadres" tiene que ser 0: es la conciliación del stock (saldo de cada
-- lote = suma de sus movimientos, contrato §3).
--
-- Nota: la huella de la versión anterior (una lista fija de tablas) no es
-- comparable con esta; las huellas viejas no sirven para validar una restauración.
set timezone = 'UTC';

select 'public.' || t.tablename as tabla,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', t.tablename), false, true, '')))[1]::text::bigint as filas,
       md5(query_to_xml(format('select * from public.%I order by id', t.tablename), false, false, '')::text) as resumen
from pg_tables t
where t.schemaname = 'public'
union all
-- Usuarios de Auth: solo id y correo (las demás columnas cambian con cada ingreso).
select 'auth.users', count(*), md5(coalesce(string_agg(id::text || coalesce(email, ''), '|' order by id), ''))
from auth.users
union all
select 'storage.buckets', count(*), md5(coalesce(string_agg(id || public::text, '|' order by id), ''))
from storage.buckets
union all
select 'storage.objects', count(*), md5(coalesce(string_agg(bucket_id || name, '|' order by bucket_id, name), ''))
from storage.objects
union all
-- Secuencias del esquema public (por ejemplo la del SKU).
select 'seq.' || sequencename, coalesce(last_value, 0), ''
from pg_sequences
where schemaname = 'public'
union all
select 'descuadres',
       (select count(*) from public.product_batches b
         where b.quantity_available is distinct from
           (select coalesce(sum(m.signed_quantity), 0) from public.stock_movements m where m.batch_id = b.id)),
       ''
order by 1;
