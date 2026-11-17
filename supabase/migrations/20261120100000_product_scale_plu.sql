-- PLU de balanza en productos (contrato v0.11.0, §21).
--
-- Migración ADITIVA: products.scale_plu es nulable y sin default; las filas existentes quedan en
-- NULL y no cambia ningún dato. El CHECK solo se evalúa sobre filas con PLU, así que no puede
-- fallar con los datos actuales. Sirve para que la caja preseleccione el producto al escanear la
-- etiqueta de la balanza (el importe se sigue escribiendo, §20).
--
-- * products_restrict_staff_update NO se toca: compara el registro completo (to_jsonb), así que
--   el empleado ya no puede cambiar la columna nueva (lo comprueba la prueba 25).
-- * v_product_list se reemplaza con create or replace agregando scale_plu AL FINAL.
-- * create_product cambia de firma (p_scale_plu): se borra la anterior para no dejar dos
--   sobrecargas (mismo método que la migración 20261116210000).

-- ---------------------------------------------------------------------------
-- 1. Columna y restricciones
-- ---------------------------------------------------------------------------
alter table public.products
  add column scale_plu text,
  add constraint products_scale_plu_format_check check (scale_plu ~ '^[0-9]{5}$' and scale_plu <> '00000'),
  add constraint products_scale_plu_unit_check check (scale_plu is null or sale_unit = 'kg');

create unique index products_scale_plu_key on public.products (scale_plu) where scale_plu is not null;

-- Lo edita encargado o dueño (y programador); al empleado lo frena products_restrict_staff_update.
-- authenticated solo tiene UPDATE por columna sobre products: sin este grant nadie podría editarla.
grant update (scale_plu) on table public.products to authenticated;

comment on column public.products.scale_plu is
  'PLU de la balanza (5 dígitos, con ceros a la izquierda). Solo productos por kilo. Único entre los que lo tienen (contrato §21).';

-- ---------------------------------------------------------------------------
-- 2. v_product_list con scale_plu al final
-- ---------------------------------------------------------------------------
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
  p.search_name,
  p.scale_plu
from public.products p
join public.categories c on c.id = p.category_id
join public.brands b on b.id = p.brand_id
left join public.suppliers s on s.id = p.supplier_id
join public.v_product_stock ps on ps.product_id = p.id;

comment on view public.v_product_list is
  'Listado de productos con nombres de catálogo y stock (contrato §7.3).';

-- ---------------------------------------------------------------------------
-- 3. create_product con p_scale_plu (contrato §8.4 y §21.3)
-- ---------------------------------------------------------------------------
drop function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text, text
);

create function public.create_product(
  p_idempotency_key uuid,
  p_name text,
  p_category_id uuid,
  p_brand_id uuid,
  p_sale_unit public.sale_unit,
  p_cost_price numeric,
  p_sale_price numeric,
  p_vat_rate numeric,
  p_barcode text default null,
  p_description text default null,
  p_supplier_id uuid default null,
  p_boxes_quantity integer default 0,
  p_units_per_box integer default 12,
  p_min_stock numeric default 0,
  p_is_active boolean default true,
  p_image_path text default null,
  p_initial_quantity numeric default null,
  p_received_on date default null,
  p_expires_on date default null,
  p_batch_number text default null,
  p_legacy_code text default null,
  p_scale_plu text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_sale_unit public.sale_unit := coalesce(p_sale_unit, 'unit'::public.sale_unit);
  v_has_stock boolean := coalesce(p_initial_quantity, 0) <> 0;
  v_received_on date;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Reintento: misma clave y mismo nombre devuelve el producto ya creado.
  select * into v_product from public.products p where p.creation_key = p_idempotency_key;
  if found then
    if lower(trim(v_product.name)) = lower(trim(coalesce(p_name, ''))) then
      return v_product;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (
    select 1 from public.stock_movements m
    where m.idempotency_key = p_idempotency_key or m.operation_key = p_idempotency_key
  ) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if v_has_stock then
    perform private.assert_valid_quantity(p_initial_quantity, v_sale_unit);
    v_received_on := private.resolve_received_on(p_received_on);
    if p_expires_on is null then
      perform private.raise_business_error('EXPIRY_REQUIRED');
    end if;
  end if;

  insert into public.products (
    name, barcode, description, category_id, brand_id, supplier_id, sale_unit, cost_price, sale_price, vat_rate,
    boxes_quantity, units_per_box, min_stock, is_active, image_path, creation_key, legacy_code, scale_plu
  )
  values (
    trim(p_name), nullif(trim(p_barcode), ''), nullif(trim(p_description), ''), p_category_id, p_brand_id,
    p_supplier_id, v_sale_unit, p_cost_price, p_sale_price, p_vat_rate,
    coalesce(p_boxes_quantity, 0), coalesce(p_units_per_box, 12), coalesce(p_min_stock, 0),
    coalesce(p_is_active, true), nullif(trim(p_image_path), ''), p_idempotency_key, nullif(trim(p_legacy_code), ''), nullif(trim(p_scale_plu), '')
  )
  returning * into v_product;

  if v_has_stock then
    perform private.create_batch_with_entry(
      p_idempotency_key, v_product.id, p_initial_quantity, v_received_on, p_expires_on, p_batch_number, null
    );
  end if;

  return v_product;
end;
$$;

comment on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text, text, text
) is
  'Alta de producto con stock inicial opcional. Solo encargado y dueño. El SKU lo genera la base. Contrato §8.4 y §21.';

revoke all on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text, text, text
) from public, anon;
grant execute on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text, text, text
) to authenticated;
