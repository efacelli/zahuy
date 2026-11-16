-- Ranking de productos vendidos (contrato v0.8.0, §17).
--
-- Solo agrega una función de lectura: no cambia tablas, columnas ni datos.
-- SECURITY DEFINER con search_path vacío (convención de la base, §8): valida el rol
-- adentro, así el empleado, el usuario inactivo y anon quedan afuera.
--
-- Una fila por producto ACTIVO (también los que no vendieron, con ceros) para que el mismo
-- resultado sirva a "más vendidos", "menos vendidos" y "sin ventas en X días".
-- Fechas locales de America/Argentina/Buenos_Aires, ambos extremos incluidos; solo cuentan
-- ventas `completed`. El costo es la copia de la venta (sale_items.unit_cost_price).

create function public.product_sales_ranking(p_from date, p_to date)
returns table (
  product_id uuid,
  sku text,
  name text,
  brand_name text,
  category_name text,
  supplier_name text,
  sale_unit public.sale_unit,
  quantity_sold numeric,
  sales_count integer,
  revenue_total numeric,
  net_total numeric,
  cost_total numeric,
  gross_margin numeric,
  last_sold_at timestamptz,
  stock_quantity numeric,
  product_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  -- Fechas nulas, invertidas o con más de 366 días (ambos extremos incluidos).
  if p_from is null or p_to is null or p_from > p_to or (p_to - p_from) + 1 > 366 then
    perform private.raise_business_error('INVALID_DATE_RANGE');
  end if;

  -- Rango [inicio del primer día, inicio del día siguiente al último) en hora de Buenos Aires:
  -- usa el índice de sales(created_at) en lugar de convertir cada fila.
  v_start := p_from::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_end := (p_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';

  return query
  with period as (
    select i.product_id as pid,
           sum(i.quantity) as qty,
           count(distinct s.id) as n,
           sum(i.line_total) as revenue,
           sum(i.net_amount) as net,
           sum(round(i.quantity * i.unit_cost_price, 2)) as cost
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    where s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end
    group by i.product_id
  )
  select
    p.id,
    p.sku,
    p.name,
    b.name,
    c.name,
    sp.name,
    p.sale_unit,
    coalesce(pe.qty, 0)::numeric(12, 3),
    coalesce(pe.n, 0)::integer,
    coalesce(pe.revenue, 0)::numeric(12, 2),
    coalesce(pe.net, 0)::numeric(12, 2),
    coalesce(pe.cost, 0)::numeric(12, 2),
    (coalesce(pe.net, 0) - coalesce(pe.cost, 0))::numeric(12, 2),
    ls.last_sold_at,
    coalesce(st.stock_quantity, 0)::numeric(12, 3),
    p.created_at
  from public.products p
  join public.categories c on c.id = p.category_id
  join public.brands b on b.id = p.brand_id
  left join public.suppliers sp on sp.id = p.supplier_id
  left join period pe on pe.pid = p.id
  left join public.v_product_stock st on st.product_id = p.id
  -- Última venta completada de siempre (no solo del período).
  left join lateral (
    select max(s.created_at) as last_sold_at
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    where i.product_id = p.id and s.status = 'completed'
  ) ls on true
  where p.is_active;
end;
$$;

comment on function public.product_sales_ranking(date, date) is
  'Ranking de productos activos con ventas del período (más vendidos, menos vendidos, sin ventas). Solo encargado, dueño y programador. Contrato §17.';

revoke all on function public.product_sales_ranking(date, date) from public, anon;
grant execute on function public.product_sales_ranking(date, date) to authenticated;
