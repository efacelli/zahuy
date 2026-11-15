-- v0.4.4: decisiones P-21 y P-22 del contrato (docs/DATA_CONTRACT.md §7.4, §5.8, §5.9, §13).
--
-- P-21: "Mermas del mes" no cuenta los movimientos que fueron anulados y
--       agrega su valor a costo (shrinkage_value_month), que sí permite sumar
--       productos distintos.
-- P-22: el borrado de una configuración de alertas por categoría queda en
--       audit_log.
--
-- Migración aditiva y compatible:
--   * audit_log: se amplía el CHECK de action para admitir 'delete'. Las filas
--     existentes (insert/update) siguen siendo válidas.
--   * write_audit_log(): mismo comportamiento para insert/update; además
--     soporta delete. No cambia ningún trigger existente.
--   * v_inventory_summary: create or replace conserva columnas, orden y
--     permisos; la columna nueva va al final.
-- No modifica datos.

-- ---------------------------------------------------------------------------
-- 1. P-22: auditoría de borrados
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check check (action in ('insert', 'update', 'delete'));

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), null, (select auth.uid()));
    return null;
  end if;

  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
      return null;
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, new.id, lower(tg_op), v_old, v_new, (select auth.uid()));
  return null;
end;
$$;

revoke all on function private.write_audit_log() from public;

-- expiry_alert_settings es la única tabla en la que la app borra filas (§5.9).
create trigger expiry_alert_settings_audit_delete
  after delete on public.expiry_alert_settings
  for each row
  execute function private.write_audit_log();

-- ---------------------------------------------------------------------------
-- 2. P-21: mermas del mes netas de anulaciones, en unidades y a costo
-- ---------------------------------------------------------------------------
create or replace view public.v_inventory_summary
with (security_invoker = true)
as
with month_losses as (
  -- Mermas, daños y consumo interno del mes (hora de Buenos Aires) que no
  -- fueron anulados. El costo es el actual del producto (sin IVA): todavía no
  -- hay costo por lote (§5.6).
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
