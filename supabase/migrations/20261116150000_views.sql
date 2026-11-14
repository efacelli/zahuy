-- v0.4 paso F: vistas de lectura.
-- Contrato: docs/DATA_CONTRACT.md v0.4.2, secciones 2.4, 3, 4.4 y 7.
--
-- Solo crea vistas y una función de cálculo; no modifica datos.
--
-- Todas las vistas usan security_invoker = true: se ejecutan con los permisos
-- y la RLS de quien consulta. Un usuario inactivo o anónimo no ve nada.
-- El stock del producto no se guarda: sale de sumar los lotes (contrato §3).

-- ---------------------------------------------------------------------------
-- 1. Estado de vencimiento (contrato §4.4): una sola definición
-- ---------------------------------------------------------------------------
-- Orden de precedencia; gana el primer caso que se cumple. Lo que vence hoy
-- cuenta como expires_urgent, no como expired. Un lote agotado nunca alerta.
create function private.expiry_status_for(
  p_expires_on date,
  p_quantity_available numeric,
  p_today date,
  p_urgent_days integer,
  p_soon_days integer,
  p_notice_days integer
)
returns public.expiry_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_quantity_available = 0 then 'depleted'::public.expiry_status
    when p_expires_on is null then 'no_expiry'::public.expiry_status
    when p_expires_on < p_today then 'expired'::public.expiry_status
    when p_expires_on <= p_today + p_urgent_days then 'expires_urgent'::public.expiry_status
    when p_expires_on <= p_today + p_soon_days then 'expires_soon'::public.expiry_status
    when p_expires_on <= p_today + p_notice_days then 'expires_upcoming'::public.expiry_status
    else 'ok'::public.expiry_status
  end;
$$;

comment on function private.expiry_status_for(date, numeric, date, integer, integer, integer) is
  'Estado de vencimiento de un lote (contrato §4.4). Única definición de la regla.';

revoke all on function private.expiry_status_for(date, numeric, date, integer, integer, integer) from public;
grant execute on function private.expiry_status_for(date, numeric, date, integer, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. v_batch_status (contrato §7.1)
-- ---------------------------------------------------------------------------
-- Columnas de product_batches, días al vencimiento, estado y, desde v0.4.2,
-- datos del producto y su categoría para la pantalla de Alertas.
-- Los días de alerta son los de la categoría del producto si tiene fila
-- propia en expiry_alert_settings; si no, los generales (7 / 15 / 30 si
-- tampoco existiera la fila general). "Hoy" es la fecha de Buenos Aires.
create view public.v_batch_status
with (security_invoker = true)
as
select
  b.id,
  b.product_id,
  b.batch_number,
  b.received_on,
  b.expires_on,
  b.quantity_initial,
  b.quantity_available,
  b.notes,
  b.created_at,
  b.created_by,
  b.updated_at,
  b.updated_by,
  (b.expires_on - t.today)::integer as days_to_expiry,
  private.expiry_status_for(
    b.expires_on, b.quantity_available, t.today, d.urgent_days, d.soon_days, d.notice_days
  ) as expiry_status,
  p.sku as product_sku,
  p.name as product_name,
  p.is_active as product_is_active,
  p.sale_unit,
  p.category_id,
  c.name as category_name
from public.product_batches b
join public.products p on p.id = b.product_id
join public.categories c on c.id = p.category_id
cross join (select private.today_ar() as today) t
left join public.expiry_alert_settings sc on sc.category_id = p.category_id
left join public.expiry_alert_settings sg on sg.category_id is null
cross join lateral (
  select
    coalesce(sc.urgent_days, sg.urgent_days, 7) as urgent_days,
    coalesce(sc.soon_days, sg.soon_days, 15) as soon_days,
    coalesce(sc.notice_days, sg.notice_days, 30) as notice_days
) d;

comment on view public.v_batch_status is
  'Lotes con días al vencimiento, estado de vencimiento y datos del producto (contrato §7.1).';

-- ---------------------------------------------------------------------------
-- 3. v_product_stock (contrato §7.2)
-- ---------------------------------------------------------------------------
-- Una fila por producto, también si no tiene lotes (stock 0).
-- Las cajas no son un segundo stock: el stock incluye todas las unidades y
-- units_in_boxes / loose_units solo muestran el desglose.
create view public.v_product_stock
with (security_invoker = true)
as
select
  p.id as product_id,
  coalesce(a.stock_quantity, 0)::numeric(12, 3) as stock_quantity,
  a.next_expires_on,
  case
    when coalesce(a.active_batches_count, 0) = 0 then null
    when a.next_expires_on is null then 'no_expiry'::public.expiry_status
    else a.next_expiry_status
  end as next_expiry_status,
  coalesce(a.active_batches_count, 0)::integer as active_batches_count,
  (coalesce(a.stock_quantity, 0) <= p.min_stock) as is_low_stock,
  (p.boxes_quantity::numeric * p.units_per_box)::numeric(12, 3) as units_in_boxes,
  (coalesce(a.stock_quantity, 0) - p.boxes_quantity::numeric * p.units_per_box)::numeric(12, 3) as loose_units,
  (coalesce(a.stock_quantity, 0) - p.boxes_quantity::numeric * p.units_per_box < 0) as has_box_mismatch
from public.products p
-- LATERAL: el stock se calcula por producto usando el índice de lotes por
-- product_id. Así un filtro del listado (búsqueda, categoría) solo calcula el
-- stock de los productos que quedan, en lugar de agregar todos los lotes.
left join lateral (
  select
    sum(bs.quantity_available) as stock_quantity,
    min(bs.expires_on) filter (where bs.quantity_available > 0) as next_expires_on,
    count(*) filter (where bs.quantity_available > 0) as active_batches_count,
    -- Estado del lote con stock que vence primero.
    (array_agg(bs.expiry_status order by bs.expires_on, bs.received_on, bs.id)
      filter (where bs.quantity_available > 0 and bs.expires_on is not null))[1] as next_expiry_status
  from public.v_batch_status bs
  where bs.product_id = p.id
) a on true;

comment on view public.v_product_stock is
  'Stock por producto calculado desde los lotes, próximo vencimiento y desglose de cajas (contrato §7.2).';

-- ---------------------------------------------------------------------------
-- 4. v_product_list (contrato §7.3)
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
  ps.has_box_mismatch
from public.products p
join public.categories c on c.id = p.category_id
join public.brands b on b.id = p.brand_id
left join public.suppliers s on s.id = p.supplier_id
join public.v_product_stock ps on ps.product_id = p.id;

comment on view public.v_product_list is
  'Listado de productos con nombres de catálogo y stock (contrato §7.3).';

-- ---------------------------------------------------------------------------
-- 5. v_inventory_summary (contrato §7.4)
-- ---------------------------------------------------------------------------
-- Una fila con las métricas del dashboard. Devuelve filas solo a encargado y
-- dueño: el filtro está en la vista, no en React.
create view public.v_inventory_summary
with (security_invoker = true)
as
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
  -- Mes actual en hora de Buenos Aires.
  (select coalesce(sum(m.quantity), 0) from public.stock_movements m
    where m.movement_type in (
        'shrinkage'::public.movement_type,
        'damage'::public.movement_type,
        'internal_use'::public.movement_type
      )
      and m.occurred_at >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
                           at time zone 'America/Argentina/Buenos_Aires'
      and m.occurred_at < (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') + interval '1 month')
                          at time zone 'America/Argentina/Buenos_Aires'
  )::numeric(14, 3) as shrinkage_quantity_month,
  (select count(*) from public.v_product_list pl where pl.has_box_mismatch)::integer as box_mismatch_products
where private.is_manager_or_admin();

comment on view public.v_inventory_summary is
  'Métricas del dashboard. Solo devuelve filas a encargado y dueño (contrato §7.4).';

-- ---------------------------------------------------------------------------
-- 6. Permisos
-- ---------------------------------------------------------------------------
revoke all on table
  public.v_batch_status, public.v_product_stock, public.v_product_list, public.v_inventory_summary
  from public, anon, authenticated;

grant select on table
  public.v_batch_status, public.v_product_stock, public.v_product_list, public.v_inventory_summary
  to authenticated;
