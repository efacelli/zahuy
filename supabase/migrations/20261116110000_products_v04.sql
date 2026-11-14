-- v0.4 paso B: SKU generado por la base, unidades por caja y precio final.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, sección 5.5.
--
-- Migración aditiva. Filas existentes:
--   * conservan su SKU;
--   * units_per_box queda en 12 (valor por defecto del contrato);
--   * sale_price_with_vat se calcula para todas a partir de su precio e IVA.

-- ---------------------------------------------------------------------------
-- 1. SKU generado por la base
-- ---------------------------------------------------------------------------
create sequence public.products_sku_seq as bigint start with 1 increment by 1;

comment on sequence public.products_sku_seq is
  'Numeración del SKU de productos. Puede dejar huecos si un alta falla.';

revoke all on sequence public.products_sku_seq from public, anon, authenticated;

-- 6 dígitos con ceros a la izquierda: 000001, 000002... Igual a
-- lpad(n::text, 6, '0') hasta 999999; a partir de 1000000 no recorta (lpad
-- devolvería '100000' y chocaría con un SKU existente).
create function private.format_product_sku(p_number bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_number < 1000000 then lpad(p_number::text, 6, '0')
    else p_number::text
  end;
$$;

-- Toma el siguiente número de la secuencia y saltea los que ya estén usados
-- como SKU (por ejemplo, productos cargados antes de esta migración).
create function private.next_product_sku()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sku text;
begin
  loop
    v_sku := private.format_product_sku(nextval('public.products_sku_seq'));
    exit when not exists (
      select 1 from public.products p where upper(p.sku) = upper(v_sku)
    );
  end loop;
  return v_sku;
end;
$$;

comment on function private.next_product_sku() is
  'Siguiente SKU libre de 6 dígitos, tomado de products_sku_seq.';

revoke all on function private.format_product_sku(bigint) from public;
revoke all on function private.next_product_sku() from public;

alter table public.products
  alter column sku set default private.next_product_sku();

-- El SKU ya no se edita desde la app.
revoke update (sku) on table public.products from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Unidades por caja
-- ---------------------------------------------------------------------------
alter table public.products
  add column units_per_box integer not null default 12,
  add constraint products_units_per_box_check check (units_per_box > 0);

comment on column public.products.units_per_box is
  'Unidades de venta por caja cerrada. Sirve para mostrar el desglose sueltas + cajas; no suma stock.';
comment on column public.products.boxes_quantity is
  'Cajas cerradas en depósito, contadas a mano. Sus unidades forman parte del stock; no son un segundo stock.';

-- Lo cambia solo el encargado o el dueño: el trigger
-- products_restrict_staff_update rechaza al empleado.
grant update (units_per_box) on table public.products to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Precio final con IVA, calculado por la base
-- ---------------------------------------------------------------------------
-- sale_price y cost_price se guardan sin IVA.
alter table public.products
  add column sale_price_with_vat numeric(12, 2)
    generated always as (round(sale_price * (1 + vat_rate / 100), 2)) stored;

comment on column public.products.sale_price is 'Precio de venta sin IVA (el que se carga).';
comment on column public.products.cost_price is 'Costo sin IVA.';
comment on column public.products.sale_price_with_vat is
  'Precio final de góndola con IVA. Lo calcula la base; no se escribe.';

-- ---------------------------------------------------------------------------
-- 4. Ajuste del trigger que limita al empleado al conteo de cajas
-- ---------------------------------------------------------------------------
-- En un trigger BEFORE, una columna generada todavía no está calculada en NEW
-- (vale NULL), así que comparar la fila completa marcaba como "cambio" el
-- precio final y rechazaba al empleado aunque solo tocara las cajas. Se
-- excluye de la comparación: el precio final depende de sale_price y vat_rate,
-- que sí se comparan.
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

  if (to_jsonb(new) - 'boxes_quantity' - 'updated_at' - 'updated_by' - 'sale_price_with_vat')
     is distinct from
     (to_jsonb(old) - 'boxes_quantity' - 'updated_at' - 'updated_by' - 'sale_price_with_vat') then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHORIZED';
  end if;

  return new;
end;
$$;
