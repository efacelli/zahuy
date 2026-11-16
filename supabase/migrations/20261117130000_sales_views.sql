-- Etapa 5 (ventas y caja), paso 4 de 5: vistas de la caja.
-- Contrato: docs/DATA_CONTRACT.md v0.6.1, §15.5 y §15.7.
--
-- Solo crea vistas (security_invoker: corren con los permisos y la RLS de quien
-- consulta). No modifica datos.
--
-- Arqueo a ciegas (P-40): para el empleado, mientras una sesión está abierta,
-- los importes de efectivo (cash_collected, cash_rounding_total, expected_cash,
-- counted_cash, difference) vienen NULL. El encargado y el dueño ven todo. El
-- empleado ve las sesiones abiertas (para elegir caja) pero, por la RLS de
-- sales, sus sales_count y sales_total cuentan solo las ventas que él hizo.

create view public.v_cash_session_summary
with (security_invoker = true)
as
select
  s.id as cash_session_id,
  s.cash_register_id,
  r.name as cash_register_name,
  s.status,
  s.opened_at,
  s.opened_by,
  s.closed_at,
  s.closed_by,
  s.opening_amount,
  coalesce(a.sales_count, 0)::integer as sales_count,
  coalesce(a.sales_total, 0)::numeric(12, 2) as sales_total,
  coalesce(a.voided_count, 0)::integer as voided_count,
  case when m.is_manager then coalesce(a.cash_collected, 0)::numeric(12, 2) end as cash_collected,
  case when m.is_manager then coalesce(a.cash_rounding_total, 0)::numeric(12, 2) end as cash_rounding_total,
  case
    when s.status = 'closed' and (m.is_manager or s.opened_by = (select auth.uid())) then s.expected_cash
    when s.status = 'open' and m.is_manager then (s.opening_amount + coalesce(a.cash_collected, 0))::numeric(12, 2)
  end as expected_cash,
  case when s.status = 'closed' and (m.is_manager or s.opened_by = (select auth.uid())) then s.counted_cash end as counted_cash,
  case when s.status = 'closed' and (m.is_manager or s.opened_by = (select auth.uid())) then s.difference end as difference
from public.cash_sessions s
join public.cash_registers r on r.id = s.cash_register_id
cross join lateral (select private.is_manager_or_admin() as is_manager) m
left join lateral (
  select
    count(*) filter (where x.status = 'completed') as sales_count,
    sum(x.total_amount) filter (where x.status = 'completed') as sales_total,
    count(*) filter (where x.status = 'voided') as voided_count,
    sum(x.cash_rounding) filter (where x.status = 'completed') as cash_rounding_total,
    (
      select sum(p.amount)
      from public.sale_payments p
      join public.payment_methods pm on pm.id = p.payment_method_id and pm.is_cash
      join public.sales x2 on x2.id = p.sale_id
      where x2.cash_session_id = s.id and x2.status = 'completed'
    ) as cash_collected
  from public.sales x
  where x.cash_session_id = s.id
) a on true;

comment on view public.v_cash_session_summary is
  'Una fila por sesión de caja (contrato §15.5). Arqueo a ciegas: el empleado no ve los importes de efectivo de una sesión abierta (P-40).';

create view public.v_cash_session_payments
with (security_invoker = true)
as
select
  s.id as cash_session_id,
  pm.id as payment_method_id,
  pm.code as payment_method_code,
  pm.name as payment_method_name,
  count(*)::integer as payments_count,
  sum(p.amount)::numeric(12, 2) as amount_total
from public.cash_sessions s
join public.sales x on x.cash_session_id = s.id and x.status = 'completed'
join public.sale_payments p on p.sale_id = x.id
join public.payment_methods pm on pm.id = p.payment_method_id
where (select private.is_manager_or_admin()) or s.opened_by = (select auth.uid())
group by s.id, pm.id, pm.code, pm.name;

comment on view public.v_cash_session_payments is
  'Una fila por sesión y medio de pago, solo ventas completadas (contrato §15.5). El empleado ve las de sus propias sesiones.';

revoke all on table public.v_cash_session_summary, public.v_cash_session_payments
  from public, anon, authenticated;
grant select on table public.v_cash_session_summary, public.v_cash_session_payments to authenticated;
