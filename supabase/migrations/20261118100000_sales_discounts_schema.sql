-- Descuentos por cantidad (contrato v0.7.0, §16), paso 1 de 3: esquema.
--
-- Migración ADITIVA y compatible hacia atrás:
--   * sales_settings: tres columnas con default (paso 6, 5 % por escalón, tope 30 %).
--   * sale_items: cuatro columnas nuevas. Las filas existentes quedan con
--     list_line_total = line_total y descuentos en 0 (relleno en esta misma migración).
--   * sales: discount_total con default 0.
-- No borra ni reescribe importes: line_total, net_amount y vat_amount de las ventas
-- existentes no cambian, así que siguen valiendo los invariantes de §15.
--
-- Las filas de sale_items son inmutables (trigger append-only). El único relleno que
-- hace falta (list_line_total = line_total) se hace
-- desactivando solo ese trigger dentro de esta transacción, y se verifica al terminar: si
-- quedara alguna fila sin completar o con importes distintos, la migración falla
-- entera y no se aplica nada.

-- ---------------------------------------------------------------------------
-- 1. sales_settings: regla del descuento (configurable)
-- ---------------------------------------------------------------------------
alter table public.sales_settings
  add column quantity_discount_step integer not null default 6,
  add column quantity_discount_percent numeric(5, 2) not null default 5,
  add column quantity_discount_max_percent numeric(5, 2) not null default 30,
  add constraint sales_settings_quantity_discount_step_check check (quantity_discount_step > 0),
  add constraint sales_settings_quantity_discount_percent_check
    check (quantity_discount_percent >= 0 and quantity_discount_percent < 100),
  -- Con 100 % la línea quedaría en 0 y chocaría con line_total > 0.
  add constraint sales_settings_quantity_discount_max_percent_check
    check (quantity_discount_max_percent >= 0 and quantity_discount_max_percent < 100);

comment on column public.sales_settings.quantity_discount_step is
  'Cada cuántas unidades sube el descuento por cantidad (contrato §16.2).';
comment on column public.sales_settings.quantity_discount_percent is
  'Cuánto sube el descuento por cada escalón (contrato §16.2).';
comment on column public.sales_settings.quantity_discount_max_percent is
  'Tope del descuento por línea: limita el sugerido y lo que escribe el cajero (P-41).';

grant update (quantity_discount_step, quantity_discount_percent, quantity_discount_max_percent)
  on table public.sales_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. sale_items: descuento por línea
-- ---------------------------------------------------------------------------
alter table public.sale_items
  add column list_line_total numeric(12, 2),
  add column suggested_discount_percent numeric(5, 2) not null default 0,
  add column discount_percent numeric(5, 2) not null default 0,
  add column discount_amount numeric(12, 2) not null default 0;

-- Relleno de las filas existentes: la línea sin descuento es la que ya se cobraba.
-- Se desactiva SOLO el trigger de solo-agregado de sale_items durante este UPDATE (dentro de
-- esta transacción) y se vuelve a activar enseguida; no hace falta ningún rol privilegiado.
alter table public.sale_items disable trigger sale_items_append_only;
update public.sale_items set list_line_total = line_total where list_line_total is null;
alter table public.sale_items enable trigger sale_items_append_only;

do $$
declare
  v_missing bigint;
  v_changed bigint;
begin
  select count(*) into v_missing from public.sale_items where list_line_total is null;
  select count(*) into v_changed from public.sale_items where list_line_total <> line_total;
  if v_missing > 0 or v_changed > 0 then
    raise exception 'MIGRATION_ABORTED: relleno de list_line_total incompleto (sin valor=%, distintos=%)', v_missing, v_changed;
  end if;
end;
$$;

alter table public.sale_items
  alter column list_line_total set not null,
  add constraint sale_items_list_line_total_check check (list_line_total > 0),
  add constraint sale_items_suggested_discount_percent_check
    check (suggested_discount_percent >= 0 and suggested_discount_percent < 100),
  add constraint sale_items_discount_percent_check check (discount_percent >= 0 and discount_percent < 100),
  add constraint sale_items_discount_amount_check check (discount_amount >= 0 and discount_amount < list_line_total),
  -- line_total sigue siendo lo que se cobra por la línea.
  add constraint sale_items_line_total_discount_check check (line_total + discount_amount = list_line_total);

comment on column public.sale_items.list_line_total is
  'Línea sin descuento: round(quantity * unit_price_with_vat, 2). line_total = list_line_total - discount_amount.';
comment on column public.sale_items.suggested_discount_percent is
  'Descuento que sugirió la regla al vender (para auditar cuánto se aparta el cajero).';
comment on column public.sale_items.discount_percent is 'Descuento aplicado a la línea (0 a 30 por defecto, P-41/P-42).';
comment on column public.sale_items.discount_amount is 'round(list_line_total * discount_percent / 100, 2).';

-- ---------------------------------------------------------------------------
-- 3. sales.discount_total
-- ---------------------------------------------------------------------------
alter table public.sales
  add column discount_total numeric(12, 2) not null default 0,
  add constraint sales_discount_total_check check (discount_total >= 0);

comment on column public.sales.discount_total is 'Σ discount_amount de los ítems (contrato §16.2).';

-- ---------------------------------------------------------------------------
-- 4. Consistencia de cada venta: ahora también el total de descuentos
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

  select count(*) into v_bad_items
  from public.sale_items i
  where i.sale_id = new.id
    and i.quantity is distinct from (
      select coalesce(sum(m.quantity), 0) from public.stock_movements m
      where m.sale_item_id = i.id and m.movement_type = 'sale'::public.movement_type
    );
  if v_bad_items > 0 then
    raise exception 'Venta % inconsistente: el stock descontado no coincide con los ítems', new.id using errcode = '23514';
  end if;

  return null;
end;
$$;
