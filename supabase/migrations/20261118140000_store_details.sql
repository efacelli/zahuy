-- Datos del comercio para el ticket (contrato v0.9.x, §18).
--
-- Migración ADITIVA: tres columnas NULABLES en sales_settings, sin relleno y sin cambios de
-- comportamiento para nada de lo ya hecho (por defecto el ticket sale sin encabezado, como hoy).
-- Son datos del comercio que viven solo en la base: no se cargan acá (el repositorio es público).
--
-- Las leen todos los usuarios activos (el empleado imprime el ticket; ya tienen SELECT sobre la
-- tabla) y las editan encargado, dueño y programador: el UPDATE por columna se otorga abajo y la
-- RLS de sales_settings ya limita el UPDATE a private.is_manager_or_admin(). Los cambios quedan en
-- audit_log por el trigger que ya tiene la tabla.

alter table public.sales_settings
  add column store_name text,
  add column store_address text,
  add column store_tax_id text,
  add constraint sales_settings_store_name_check
    check (store_name is null or length(trim(store_name)) between 1 and 80),
  add constraint sales_settings_store_address_check
    check (store_address is null or length(trim(store_address)) between 1 and 120),
  -- CUIT: 11 dígitos sin guiones. La base no valida el dígito verificador.
  add constraint sales_settings_store_tax_id_check
    check (store_tax_id is null or store_tax_id ~ '^[0-9]{11}$');

comment on column public.sales_settings.store_name is 'Nombre del comercio para el encabezado del ticket (opcional).';
comment on column public.sales_settings.store_address is 'Dirección del comercio para el encabezado del ticket (opcional).';
comment on column public.sales_settings.store_tax_id is
  'CUIT del comercio, 11 dígitos sin guiones (opcional). El ticket lo muestra solo si está cargado (P-49: por ahora no se carga).';

grant update (store_name, store_address, store_tax_id) on table public.sales_settings to authenticated;
