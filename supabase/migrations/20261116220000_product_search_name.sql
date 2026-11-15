-- v0.5.1: búsqueda de productos sin tildes ni mayúsculas (contrato §5.5 y §7.3).
--
-- products.search_name es una columna generada: lower(unaccent(name)). La app
-- normaliza lo que escribe el usuario igual y busca con ilike sobre ella, así
-- "lacteos", "LÁCTEOS" y "Lácteos" encuentran lo mismo.
--
-- Migración aditiva:
--   * La columna generada se calcula sola para las filas existentes (no hay
--     que completar datos) y nadie la escribe.
--   * v_product_list se reemplaza con create or replace agregando search_name
--     AL FINAL: no se borra ni cambia ninguna columna existente, conserva
--     permisos y security_invoker, y v_inventory_summary no se toca.
-- No modifica datos.

alter table public.products
  add column search_name text generated always as (lower(private.unaccent_text(name))) stored;

comment on column public.products.search_name is
  'Nombre sin tildes y en minúscula, para buscar (v0.5.1). Generada; no se escribe.';

create or replace view public.v_product_list
with (security_invoker = true)
as
select
  p.id,
  p.sku,
  p.barcode,
  p.name,
  p.description,
  p.category_id,
  c.name as category_name,
  p.brand_id,
  b.name as brand_name,
  p.supplier_id,
  s.name as supplier_name,
  p.sale_unit,
  p.cost_price,
  p.sale_price,
  p.sale_price_with_vat,
  p.vat_rate,
  p.boxes_quantity,
  p.units_per_box,
  p.min_stock,
  p.is_active,
  p.image_path,
  p.created_at,
  p.updated_at,
  ps.stock_quantity,
  ps.next_expires_on,
  ps.next_expiry_status,
  ps.active_batches_count,
  ps.is_low_stock,
  ps.units_in_boxes,
  ps.loose_units,
  ps.has_box_mismatch,
  p.legacy_code,
  p.search_name
from public.products p
join public.categories c on c.id = p.category_id
join public.brands b on b.id = p.brand_id
left join public.suppliers s on s.id = p.supplier_id
join public.v_product_stock ps on ps.product_id = p.id;

comment on view public.v_product_list is
  'Listado de productos con nombres de catálogo y stock (contrato §7.3).';

-- En un trigger BEFORE las columnas generadas todavía no están calculadas en
-- NEW (valen NULL). Igual que con sale_price_with_vat (migración
-- 20261116110000), search_name se excluye de la comparación: depende de name,
-- que sí se compara. Sin esto, el empleado no podría actualizar las cajas.
create or replace function private.products_restrict_staff_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Sin sesión de usuario (semilla, migración, rol privilegiado): sin restricción.
  if (select auth.uid()) is null or private.is_manager_or_admin() then
    return new;
  end if;

  if (to_jsonb(new) - 'boxes_quantity' - 'updated_at' - 'updated_by' - 'sale_price_with_vat' - 'search_name')
     is distinct from
     (to_jsonb(old) - 'boxes_quantity' - 'updated_at' - 'updated_by' - 'sale_price_with_vat' - 'search_name') then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHORIZED';
  end if;

  return new;
end;
$$;
