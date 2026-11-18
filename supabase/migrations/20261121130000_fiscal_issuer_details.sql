-- Facturación ARCA: datos del emisor que van impresos en la factura (contrato v0.12.0, §22.11).
--
-- La factura electrónica lleva razón social, CUIT, domicilio comercial, número de Ingresos Brutos y fecha de
-- inicio de actividades. Se guardan en fiscal_settings (no en sales_settings): son datos FISCALES del titular y
-- no deben cambiar el ticket interno de §15 (P-49: un comprobante interno con CUIT se parece a una factura).
--
-- Migración ADITIVA: cinco columnas nulables, sin default ni dato cargado (el repositorio es público; los datos
-- del titular se cargan desde la app y viven solo en la base). Las filas existentes quedan en NULL.

alter table public.fiscal_settings
  add column issuer_name text,
  add column issuer_tax_id text,
  add column issuer_address text,
  add column gross_income_number text,
  add column activity_start_date date,
  add constraint fiscal_settings_issuer_name_check check (length(trim(issuer_name)) between 1 and 80),
  add constraint fiscal_settings_issuer_tax_id_check check (issuer_tax_id ~ '^[0-9]{11}$'),
  add constraint fiscal_settings_issuer_address_check check (length(trim(issuer_address)) between 1 and 120),
  add constraint fiscal_settings_gross_income_check check (gross_income_number ~ '^[0-9-]{1,20}$');

comment on column public.fiscal_settings.issuer_name is 'Razón social del emisor, tal como va en la factura (1 a 80 caracteres).';
comment on column public.fiscal_settings.issuer_tax_id is 'CUIT del emisor, 11 dígitos sin guiones.';
comment on column public.fiscal_settings.issuer_address is 'Domicilio comercial del emisor (1 a 120 caracteres).';
comment on column public.fiscal_settings.gross_income_number is 'Número de Ingresos Brutos (dígitos y guiones).';
comment on column public.fiscal_settings.activity_start_date is 'Fecha de inicio de actividades que va en la factura.';

-- Los edita el dueño o el programador (la política de UPDATE de §22.2); lo leen todos los usuarios activos para imprimir.
grant update (issuer_name, issuer_tax_id, issuer_address, gross_income_number, activity_start_date)
  on table public.fiscal_settings to authenticated;
