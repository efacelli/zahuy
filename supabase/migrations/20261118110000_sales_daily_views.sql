-- Descuentos por cantidad y métricas de ventas (contrato v0.7.0, §16), paso 2 de 3: vistas.
--
-- Solo crea vistas (security_invoker: corren con los permisos y la RLS de quien consulta).
-- No modifica datos. Solo encargado, dueño y programador ven filas (el empleado no):
-- las filas se filtran con private.is_manager_or_admin(), que ya incluye a esos roles.
-- Todas las columnas cuentan solo ventas `completed` (también cost_total), salvo voided_count.
-- El día es la fecha local de sales.created_at en America/Argentina/Buenos_Aires.

create view public.v_sales_daily
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
  (coalesce(sum(d.net_amount) filter (where d.status = 'completed'), 0)
    - coalesce(sum(d.cost) filter (where d.status = 'completed'), 0))::numeric(12, 2) as gross_margin
from (
  select
    (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date as sale_date,
    s.status, s.total_amount, s.net_amount, s.vat_amount, s.discount_total, s.rounding_amount,
    (select sum(round(i.quantity * i.unit_cost_price, 2)) from public.sale_items i where i.sale_id = s.id) as cost
  from public.sales s
  where (select private.is_manager_or_admin())
) d
group by d.sale_date;

comment on view public.v_sales_daily is
  'Una fila por día: ventas, IVA, descuentos, redondeo, costo y margen bruto (contrato §16.4). Solo encargado, dueño y programador.';

create view public.v_sales_daily_payments
with (security_invoker = true)
as
select
  (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date as sale_date,
  pm.id as payment_method_id,
  pm.code as payment_method_code,
  pm.name as payment_method_name,
  (count(*))::integer as payments_count,
  (sum(p.amount))::numeric(12, 2) as amount_total
from public.sales s
join public.sale_payments p on p.sale_id = s.id
join public.payment_methods pm on pm.id = p.payment_method_id
where s.status = 'completed' and (select private.is_manager_or_admin())
group by 1, pm.id, pm.code, pm.name;

comment on view public.v_sales_daily_payments is
  'Una fila por día y medio de pago, solo ventas completadas (contrato §16.4). Solo encargado, dueño y programador.';

revoke all on table public.v_sales_daily, public.v_sales_daily_payments from public, anon, authenticated;
grant select on table public.v_sales_daily, public.v_sales_daily_payments to authenticated;
