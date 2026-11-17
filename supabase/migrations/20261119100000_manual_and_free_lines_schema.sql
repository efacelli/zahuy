-- Importe manual para productos de balanza y líneas libres (contrato v0.10.0, §20), paso 1 de 2: esquema.
--
-- Migración ADITIVA para lo ya hecho: las filas existentes de sale_items quedan con
-- price_source = 'list' y catalog_line_total nulo, y ningún importe cambia. Lo único que se
-- relaja es el NOT NULL de product_id, product_sku y unit_cost_price, que pasan a nulables
-- SOLO para las líneas libres (price_source = 'free'): un CHECK lo exige. Quitar un NOT NULL es
-- un cambio de metadatos: no reescribe la tabla ni toca ninguna fila.
--
-- * price_source = 'manual': producto por kilo cobrado con el importe de la etiqueta de la balanza
--   (catalog_line_total guarda lo que daba el precio de Zahuy en ese instante, para auditar).
-- * price_source = 'free': línea sin producto (descripción, IVA, cantidad e importe): no descuenta
--   stock y no tiene costo conocido.

-- ---------------------------------------------------------------------------
-- 1. sale_items
-- ---------------------------------------------------------------------------
alter table public.sale_items
  add column price_source text not null default 'list',
  add column catalog_line_total numeric(12, 2),
  alter column product_id drop not null,
  alter column product_sku drop not null,
  alter column unit_cost_price drop not null,
  add constraint sale_items_price_source_check check (price_source in ('list', 'manual', 'free')),
  -- Sin producto solo en las líneas libres, y todas las libres sin producto.
  add constraint sale_items_free_product_check check ((price_source = 'free') = (product_id is null)),
  -- SKU y costo solo pueden faltar en las libres (que no tienen costo conocido).
  add constraint sale_items_free_snapshot_check check (
    (price_source = 'free' and product_sku is null and unit_cost_price is null)
    or (price_source <> 'free' and product_sku is not null and unit_cost_price is not null)
  ),
  -- El importe de catálogo solo existe en las líneas con importe manual.
  add constraint sale_items_catalog_total_check check ((price_source = 'manual') = (catalog_line_total is not null)),
  -- Línea libre: descripción de 1 a 80 caracteres, IVA 10,5 o 21, cantidad entera.
  add constraint sale_items_free_fields_check check (
    price_source <> 'free'
    or (length(trim(product_name)) between 1 and 80
        and vat_rate in (10.50, 21.00)
        and quantity = trunc(quantity))
  ),
  -- Con importe manual o libre no hay descuento por cantidad.
  add constraint sale_items_manual_no_discount_check check (price_source = 'list' or discount_amount = 0);

comment on column public.sale_items.price_source is
  'list = precio de Zahuy; manual = importe de la etiqueta de balanza (producto por kg); free = línea libre sin producto (contrato §20).';
comment on column public.sale_items.catalog_line_total is
  'Solo con price_source = manual: round(cantidad * precio con IVA de Zahuy) en ese instante, para auditar la diferencia con el importe cobrado.';

-- ---------------------------------------------------------------------------
-- 2. Consistencia de cada venta: las líneas libres no tienen movimientos de stock
-- ---------------------------------------------------------------------------
create or replace function private.check_sale_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_items numeric;
  v_net numeric;
  v_vat numeric;
  v_discount numeric;
  v_count int;
  v_paid numeric;
  v_bad_items int;
begin
  select coalesce(sum(i.line_total), 0), coalesce(sum(i.net_amount), 0), coalesce(sum(i.vat_amount), 0),
         coalesce(sum(i.discount_amount), 0), count(*)
    into v_items, v_net, v_vat, v_discount, v_count
  from public.sale_items i where i.sale_id = new.id;

  if v_count = 0 or v_items <> new.total_amount or v_net <> new.net_amount or v_vat <> new.vat_amount then
    raise exception 'Venta % inconsistente: los ítems no suman el total', new.id using errcode = '23514';
  end if;
  if v_discount <> new.discount_total then
    raise exception 'Venta % inconsistente: el total de descuentos no coincide con los ítems', new.id using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0) into v_paid from public.sale_payments p where p.sale_id = new.id;
  if v_paid <> new.total_amount + new.rounding_amount then
    raise exception 'Venta % inconsistente: los pagos no suman el total más el redondeo', new.id using errcode = '23514';
  end if;

  -- El stock descontado de cada ítem con producto es exactamente su cantidad. Las líneas libres
  -- (price_source = 'free') no descuentan stock y no tienen movimientos: quedan afuera.
  select count(*) into v_bad_items
  from public.sale_items i
  where i.sale_id = new.id
    and i.price_source <> 'free'
    and i.quantity is distinct from (
      select coalesce(sum(m.quantity), 0) from public.stock_movements m
      where m.sale_item_id = i.id and m.movement_type = 'sale'::public.movement_type
    );
  if v_bad_items > 0 then
    raise exception 'Venta % inconsistente: el stock descontado no coincide con los ítems', new.id using errcode = '23514';
  end if;

  -- Una línea libre nunca tiene movimientos (un movimiento exige un ítem con producto).
  if exists (
    select 1 from public.sale_items i
    join public.stock_movements m on m.sale_item_id = i.id
    where i.sale_id = new.id and i.price_source = 'free'
  ) then
    raise exception 'Venta % inconsistente: una línea libre tiene movimientos de stock', new.id using errcode = '23514';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. v_sales_daily: el margen solo cuenta las líneas con costo (+ free_net_total)
-- ---------------------------------------------------------------------------
-- Una línea libre no tiene costo: si su neto entrara completo en el margen, el margen quedaría inflado.
-- total_amount, net_amount y vat_amount SIGUEN incluyendo las líneas libres (son ventas reales).
-- gross_margin = Σ(neto - costo) de las líneas CON costo. free_net_total (columna nueva, al final)
-- es el neto cobrado en líneas libres, para mostrarlo aparte. Mismas columnas y tipos que antes.
create or replace view public.v_sales_daily
with (security_invoker = true)
as
select
  d.sale_date,
  (count(*) filter (where d.status = 'completed'))::integer as sales_count,
  (count(*) filter (where d.status = 'voided'))::integer as voided_count,
  (coalesce(sum(d.total_amount) filter (where d.status = 'completed'), 0))::numeric(12, 2) as total_amount,
  (coalesce(sum(d.net_amount) filter (where d.status = 'completed'), 0))::numeric(12, 2) as net_amount,
  (coalesce(sum(d.vat_amount) filter (where d.status = 'completed'), 0))::numeric(12, 2) as vat_amount,
  (coalesce(sum(d.discount_total) filter (where d.status = 'completed'), 0))::numeric(12, 2) as discount_total,
  (coalesce(sum(d.rounding_amount) filter (where d.status = 'completed'), 0))::numeric(12, 2) as rounding_total,
  (coalesce(sum(d.cost) filter (where d.status = 'completed'), 0))::numeric(12, 2) as cost_total,
  (coalesce(sum(d.costed_net) filter (where d.status = 'completed'), 0)
    - coalesce(sum(d.cost) filter (where d.status = 'completed'), 0))::numeric(12, 2) as gross_margin,
  (coalesce(sum(d.free_net) filter (where d.status = 'completed'), 0))::numeric(12, 2) as free_net_total
from (
  select
    (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date as sale_date,
    s.status, s.total_amount, s.net_amount, s.vat_amount, s.discount_total, s.rounding_amount,
    (select sum(round(i.quantity * i.unit_cost_price, 2)) from public.sale_items i where i.sale_id = s.id) as cost,
    (select sum(i.net_amount) from public.sale_items i where i.sale_id = s.id and i.unit_cost_price is not null) as costed_net,
    (select sum(i.net_amount) from public.sale_items i where i.sale_id = s.id and i.price_source = 'free') as free_net
  from public.sales s
  where (select private.is_manager_or_admin())
) d
group by d.sale_date;
