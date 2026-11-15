-- v0.5.0: importación del sistema anterior (contrato §5.5, §7.3, §8.4; P-24, P-25).
--
-- P-24: products.sale_price pasa de numeric(12,2) a numeric(12,4) para que el
--       precio final de góndola (sale_price_with_vat) se reproduzca exacto.
-- P-25: products.legacy_code guarda el código propio del sistema anterior,
--       único y buscable. create_product lo recibe en p_legacy_code.
--
-- Plan de transición (datos existentes):
--   * Ampliar la escala de 2 a 4 decimales no pierde datos: 991.74 sigue
--     siendo 991.7400 y el precio final de cada producto no cambia.
--   * Postgres no deja cambiar el tipo de una columna usada por una columna
--     generada o por una vista. Por eso, dentro de esta misma transacción:
--       1. se borran v_inventory_summary y v_product_list (las únicas vistas
--          que usan sale_price; v_product_stock y v_batch_status no cambian),
--       2. se borra la columna generada sale_price_with_vat,
--       3. se cambia el tipo de sale_price,
--       4. se vuelve a crear sale_price_with_vat con la MISMA fórmula,
--       5. se recrean las dos vistas con la MISMA definición (v_product_list
--          suma legacy_code al final) y los mismos permisos.
--   * legacy_code es nulable: las filas existentes quedan en NULL.
-- No borra ni modifica filas.

-- ---------------------------------------------------------------------------
-- 1. Vistas que dependen de sale_price
-- ---------------------------------------------------------------------------
drop view public.v_inventory_summary;
drop view public.v_product_list;

-- ---------------------------------------------------------------------------
-- 2. P-24: sale_price con 4 decimales
-- ---------------------------------------------------------------------------
alter table public.products drop column sale_price_with_vat;

alter table public.products alter column sale_price type numeric(12, 4);

alter table public.products
  add column sale_price_with_vat numeric(12, 2)
    generated always as (round(sale_price * (1 + vat_rate / 100), 2)) stored;

comment on column public.products.sale_price is
  'Precio de venta sin IVA, 4 decimales (P-24) para que el precio final con IVA sea exacto.';
comment on column public.products.sale_price_with_vat is
  'Precio final de góndola con IVA, calculado por la base. No se escribe.';

-- ---------------------------------------------------------------------------
-- 3. P-25: código del sistema anterior
-- ---------------------------------------------------------------------------
alter table public.products
  add column legacy_code text,
  add constraint products_legacy_code_check
    check (legacy_code = trim(legacy_code) and length(legacy_code) between 1 and 40);

create unique index products_legacy_code_key on public.products (upper(legacy_code))
  where legacy_code is not null;

comment on column public.products.legacy_code is
  'Código propio del sistema anterior del cliente (P-25). Único y buscable; no reemplaza al SKU.';

-- Lo edita encargado o dueño; al empleado lo frena products_restrict_staff_update.
grant update (legacy_code) on table public.products to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Vistas, recreadas igual (v_product_list suma legacy_code al final)
-- ---------------------------------------------------------------------------
create view public.v_product_list
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
  p.legacy_code
from public.products p
join public.categories c on c.id = p.category_id
join public.brands b on b.id = p.brand_id
left join public.suppliers s on s.id = p.supplier_id
join public.v_product_stock ps on ps.product_id = p.id;

comment on view public.v_product_list is
  'Listado de productos con nombres de catálogo y stock (contrato §7.3).';

create view public.v_inventory_summary
with (security_invoker = true)
as
with month_losses as (
  select m.quantity, p.cost_price
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  where m.movement_type in (
      'shrinkage'::public.movement_type,
      'damage'::public.movement_type,
      'internal_use'::public.movement_type
    )
    and m.occurred_at >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
                         at time zone 'America/Argentina/Buenos_Aires'
    and m.occurred_at < (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') + interval '1 month')
                        at time zone 'America/Argentina/Buenos_Aires'
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
)
select
  (select count(*) from public.v_product_list pl where pl.is_active)::integer as active_products,
  (select count(*) from public.v_product_list pl where pl.is_active and pl.is_low_stock)::integer as low_stock_products,
  (select count(*) from public.v_product_list pl
    where pl.is_active
      and pl.next_expiry_status in (
        'expires_urgent'::public.expiry_status,
        'expires_soon'::public.expiry_status,
        'expires_upcoming'::public.expiry_status
      ))::integer as expiring_products,
  (select count(*) from public.v_batch_status bs
    where bs.expiry_status = 'expired'::public.expiry_status)::integer as expired_batches,
  (select coalesce(sum(pl.stock_quantity * pl.cost_price), 0) from public.v_product_list pl
    where pl.is_active)::numeric(14, 2) as stock_value_cost,
  (select coalesce(sum(pl.stock_quantity * pl.sale_price_with_vat), 0) from public.v_product_list pl
    where pl.is_active)::numeric(14, 2) as stock_value_sale,
  (select coalesce(sum(ml.quantity), 0) from month_losses ml)::numeric(14, 3) as shrinkage_quantity_month,
  (select count(*) from public.v_product_list pl where pl.has_box_mismatch)::integer as box_mismatch_products,
  (select coalesce(sum(ml.quantity * ml.cost_price), 0) from month_losses ml)::numeric(14, 2) as shrinkage_value_month
where private.is_manager_or_admin();

comment on view public.v_inventory_summary is
  'Métricas del dashboard. Solo devuelve filas a encargado y dueño (contrato §7.4). '
  'Mermas del mes: sin las anuladas, en unidades y a costo (P-21).';

revoke all on table public.v_product_list, public.v_inventory_summary from public, anon, authenticated;
grant select on table public.v_product_list, public.v_inventory_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_product con p_legacy_code (contrato §8.4)
-- ---------------------------------------------------------------------------
-- Cambia la firma: se borra la versión anterior para no dejar dos funciones.
drop function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text
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
  p_legacy_code text default null
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
    boxes_quantity, units_per_box, min_stock, is_active, image_path, creation_key, legacy_code
  )
  values (
    trim(p_name), nullif(trim(p_barcode), ''), nullif(trim(p_description), ''), p_category_id, p_brand_id,
    p_supplier_id, v_sale_unit, p_cost_price, p_sale_price, p_vat_rate,
    coalesce(p_boxes_quantity, 0), coalesce(p_units_per_box, 12), coalesce(p_min_stock, 0),
    coalesce(p_is_active, true), nullif(trim(p_image_path), ''), p_idempotency_key, nullif(trim(p_legacy_code), '')
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
  boolean, text, numeric, date, date, text, text
) is
  'Alta de producto con stock inicial opcional. Solo encargado y dueño. El SKU lo genera la base. Contrato §8.4.';

revoke all on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text, text
) from public, anon;
grant execute on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text, text
) to authenticated;
