-- Historial de precios y aumentos masivos (contrato v0.9.x, §19), paso 2 de 2: funciones.
--
-- Solo crea funciones; no modifica tablas ni datos. Mismas reglas comunes que el resto de las RPC
-- (SECURITY DEFINER, search_path vacío, una transacción por llamada, errores P0001 con el código en
-- MESSAGE, EXECUTE solo para authenticated) y solo encargado, dueño y programador.
--
-- * preview_price_increase: solo lectura; la pantalla muestra «precio viejo -> nuevo» y deja excluir.
-- * apply_price_increase: RECALCULA todo adentro (no confía en la vista previa), bloquea los productos
--   afectados FOR UPDATE ordenados por id (el mismo orden que las ventas) y actualiza en una transacción.
-- * revert_price_change: deshace un aumento; saltea y informa lo que cambió de precio después.
--
-- Los costos NO se tocan (P-52). Tope de 50 % fijo (P-51). Sin filtros no se aplica (P-50).

-- ---------------------------------------------------------------------------
-- 1. Funciones auxiliares (esquema private)
-- ---------------------------------------------------------------------------
-- Precio final redondeado a un múltiplo: exacto con menos de la mitad del múltiplo (como P-39), si no
-- el múltiplo más cercano y desde la mitad sube (como round_cash, P-30).
create function private.round_price(p_amount numeric, p_multiple numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_amount is null or p_multiple is null or p_multiple <= 0 or p_amount <= 0 then p_amount
    when p_amount < p_multiple / 2 then p_amount
    else div(p_amount * 2 + p_multiple, p_multiple * 2) * p_multiple
  end;
$$;

-- Nuevo precio FINAL de góndola (con IVA) de un producto: aumento sobre el precio sin IVA, IVA, centavos y,
-- si se pidió, redondeo al múltiplo.
create function private.price_increase_final(p_sale_price numeric, p_vat_rate numeric, p_percent numeric, p_multiple numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_multiple is null then f.v else private.round_price(f.v, p_multiple) end
  from (select round(round(p_sale_price * (1 + p_percent / 100), 4) * (1 + p_vat_rate / 100), 2) as v) f;
$$;

-- Lista ordenada y sin repetidos; nula si viene nula o vacía (para comparar y guardar los filtros).
create function private.normalize_ids(p_ids uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(cardinality(p_ids), 0) = 0 then null
              else array(select distinct x from unnest(p_ids) x order by x) end;
$$;

-- Productos ACTIVOS que cumplen TODOS los filtros dados (se combinan con Y) y no están excluidos.
create function private.price_filter_ids(
  p_brand_ids uuid[], p_supplier_ids uuid[], p_category_ids uuid[], p_product_ids uuid[], p_excluded uuid[]
)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select p.id
  from public.products p
  where p.is_active
    and (coalesce(cardinality(p_brand_ids), 0) = 0 or p.brand_id = any (p_brand_ids))
    and (coalesce(cardinality(p_supplier_ids), 0) = 0 or p.supplier_id = any (p_supplier_ids))
    and (coalesce(cardinality(p_category_ids), 0) = 0 or p.category_id = any (p_category_ids))
    and (coalesce(cardinality(p_product_ids), 0) = 0 or p.id = any (p_product_ids))
    and not (p.id = any (coalesce(p_excluded, '{}'::uuid[])));
$$;

-- Validación común de preview y apply.
create function private.assert_price_increase_args(
  p_brand_ids uuid[], p_supplier_ids uuid[], p_category_ids uuid[], p_product_ids uuid[],
  p_percent numeric, p_multiple numeric
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_percent is null or p_percent = 0 or abs(p_percent) > 50 or p_percent <> round(p_percent, 3) then
    perform private.raise_business_error('INVALID_PERCENT');
  end if;
  if p_multiple is not null and (p_multiple <= 0 or p_multiple <> round(p_multiple, 2)) then
    perform private.raise_business_error('INVALID_ROUNDING');
  end if;
  if coalesce(cardinality(p_brand_ids), 0) = 0 and coalesce(cardinality(p_supplier_ids), 0) = 0
     and coalesce(cardinality(p_category_ids), 0) = 0 and coalesce(cardinality(p_product_ids), 0) = 0 then
    perform private.raise_business_error('FILTER_REQUIRED');
  end if;
end;
$$;

revoke all on function private.round_price(numeric, numeric) from public;
revoke all on function private.price_increase_final(numeric, numeric, numeric, numeric) from public;
revoke all on function private.normalize_ids(uuid[]) from public;
revoke all on function private.price_filter_ids(uuid[], uuid[], uuid[], uuid[], uuid[]) from public;
revoke all on function private.assert_price_increase_args(uuid[], uuid[], uuid[], uuid[], numeric, numeric) from public;

-- ---------------------------------------------------------------------------
-- 2. preview_price_increase (solo lectura)
-- ---------------------------------------------------------------------------
create function public.preview_price_increase(
  p_brand_ids uuid[],
  p_supplier_ids uuid[],
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_percent numeric,
  p_rounding_multiple numeric default null
)
returns table (
  product_id uuid,
  sku text,
  name text,
  brand_name text,
  category_name text,
  supplier_name text,
  old_sale_price numeric,
  old_price_with_vat numeric,
  new_sale_price numeric,
  new_price_with_vat numeric,
  change_amount numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;
  perform private.assert_price_increase_args(p_brand_ids, p_supplier_ids, p_category_ids, p_product_ids, p_percent, p_rounding_multiple);

  return query
  select
    c.id, c.sku, c.name, c.brand_name, c.category_name, c.supplier_name,
    c.sale_price,
    c.sale_price_with_vat,
    case when c.changed then c.new_sale else c.sale_price end,
    case when c.changed then c.new_final else c.sale_price_with_vat end,
    case when c.changed then c.new_final - c.sale_price_with_vat else 0::numeric end
  from (
    select
      p.id, p.sku, p.name, b.name as brand_name, cat.name as category_name, sp.name as supplier_name,
      p.sale_price, p.sale_price_with_vat, x.new_final, x.new_sale,
      -- «Sin cambio»: el precio de góndola o el sale_price quedan igual, o el resultado no es válido (0 o menos).
      (x.new_final > 0 and x.new_final <> p.sale_price_with_vat and x.new_sale <> p.sale_price) as changed
    from public.products p
    join public.brands b on b.id = p.brand_id
    join public.categories cat on cat.id = p.category_id
    left join public.suppliers sp on sp.id = p.supplier_id
    cross join lateral (
      select f.v as new_final, round(f.v / (1 + p.vat_rate / 100), 4) as new_sale
      from (select private.price_increase_final(p.sale_price, p.vat_rate, p_percent, p_rounding_multiple) as v) f
    ) x
    where p.id in (select private.price_filter_ids(p_brand_ids, p_supplier_ids, p_category_ids, p_product_ids, null))
  ) c
  order by c.name, c.id;
end;
$$;

comment on function public.preview_price_increase(uuid[], uuid[], uuid[], uuid[], numeric, numeric) is
  'Vista previa de un aumento masivo: precio viejo y nuevo de cada producto activo que cumple los filtros. Contrato §19.4.';

-- ---------------------------------------------------------------------------
-- 3. apply_price_increase
-- ---------------------------------------------------------------------------
create function public.apply_price_increase(
  p_idempotency_key uuid,
  p_brand_ids uuid[],
  p_supplier_ids uuid[],
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_percent numeric,
  p_rounding_multiple numeric default null,
  p_excluded_product_ids uuid[] default '{}',
  p_notes text default null
)
returns public.price_bulk_changes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.price_bulk_changes;
  v_bulk public.price_bulk_changes;
  v_changes jsonb := '[]'::jsonb;
  v_row record;
  v_item jsonb;
  v_final numeric;
  v_new_sale numeric;
  v_excluded uuid[] := coalesce(private.normalize_ids(p_excluded_product_ids), '{}'::uuid[]);
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Reintento: misma clave y mismos datos devuelve el aumento ya hecho.
  select * into v_existing from public.price_bulk_changes b where b.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.percent = round(p_percent, 3)
       and v_existing.rounding_multiple is not distinct from p_rounding_multiple
       and v_existing.brand_ids is not distinct from private.normalize_ids(p_brand_ids)
       and v_existing.supplier_ids is not distinct from private.normalize_ids(p_supplier_ids)
       and v_existing.category_ids is not distinct from private.normalize_ids(p_category_ids)
       and v_existing.product_ids is not distinct from private.normalize_ids(p_product_ids)
       and v_existing.excluded_product_ids = v_excluded then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  perform private.assert_price_increase_args(p_brand_ids, p_supplier_ids, p_category_ids, p_product_ids, p_percent, p_rounding_multiple);

  -- Bloquea los productos afectados ordenados por id (mismo orden que las ventas): no se traba con una
  -- venta ni con otra operación concurrente. Después de este bloqueo los precios no cambian.
  perform 1 from public.products p
  where p.id in (select private.price_filter_ids(p_brand_ids, p_supplier_ids, p_category_ids, p_product_ids, v_excluded))
  order by p.id
  for update;

  -- Recalcula con los precios ya bloqueados; no confía en ninguna vista previa del cliente.
  for v_row in
    select p.id, p.sale_price, p.sale_price_with_vat, p.vat_rate
    from public.products p
    where p.id in (select private.price_filter_ids(p_brand_ids, p_supplier_ids, p_category_ids, p_product_ids, v_excluded))
    order by p.id
  loop
    v_final := private.price_increase_final(v_row.sale_price, v_row.vat_rate, p_percent, p_rounding_multiple);
    v_new_sale := round(v_final / (1 + v_row.vat_rate / 100), 4);
    -- Sin cambio (o resultado inválido): no se actualiza, no cuenta y no deja historial.
    if v_final > 0 and v_final <> v_row.sale_price_with_vat and v_new_sale <> v_row.sale_price then
      v_changes := v_changes || jsonb_build_object('id', v_row.id, 'new_sale_price', v_new_sale);
    end if;
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    perform private.raise_business_error('NO_PRODUCTS');
  end if;

  insert into public.price_bulk_changes (
    idempotency_key, percent, rounding_multiple, brand_ids, supplier_ids, category_ids, product_ids,
    excluded_product_ids, products_count, notes, created_by
  )
  values (
    p_idempotency_key, round(p_percent, 3), p_rounding_multiple,
    private.normalize_ids(p_brand_ids), private.normalize_ids(p_supplier_ids),
    private.normalize_ids(p_category_ids), private.normalize_ids(p_product_ids),
    v_excluded, jsonb_array_length(v_changes), nullif(trim(p_notes), ''), (select auth.uid())
  )
  returning * into v_bulk;

  -- El trigger de products toma el origen de estos ajustes locales a la transacción y los valida.
  perform set_config('app.price_change_source', 'bulk_increase', true);
  perform set_config('app.price_bulk_change_id', v_bulk.id::text, true);
  perform set_config('app.price_change_reason', coalesce(nullif(trim(p_notes), ''), ''), true);

  for v_item in select value from jsonb_array_elements(v_changes)
  loop
    update public.products p
    set sale_price = (v_item ->> 'new_sale_price')::numeric
    where p.id = (v_item ->> 'id')::uuid;
  end loop;

  perform set_config('app.price_change_source', '', true);
  perform set_config('app.price_bulk_change_id', '', true);
  perform set_config('app.price_change_reason', '', true);

  return v_bulk;
end;
$$;

comment on function public.apply_price_increase(uuid, uuid[], uuid[], uuid[], uuid[], numeric, numeric, uuid[], text) is
  'Aplica un aumento masivo de precios de góndola: atómico, idempotente, recalcula adentro, bloquea en orden de id. No toca costos. Contrato §19.4.';

-- ---------------------------------------------------------------------------
-- 4. revert_price_change
-- ---------------------------------------------------------------------------
create function public.revert_price_change(
  p_idempotency_key uuid,
  p_bulk_change_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.price_bulk_changes;
  v_bulk public.price_bulk_changes;
  v_row record;
  v_restored integer := 0;
  v_skipped uuid[] := '{}'::uuid[];
  v_result jsonb;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Reintento: la misma clave devuelve el mismo resultado.
  select * into v_existing from public.price_bulk_changes b where b.revert_idempotency_key = p_idempotency_key;
  if found then
    if v_existing.id = p_bulk_change_id then
      return v_existing.revert_result;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.raise_business_error('REASON_REQUIRED');
  end if;

  select * into v_bulk from public.price_bulk_changes b where b.id = p_bulk_change_id for update;
  if not found then
    perform private.raise_business_error('PRICE_CHANGE_NOT_FOUND');
  end if;
  if v_bulk.status = 'reverted' then
    perform private.raise_business_error('ALREADY_REVERTED');
  end if;

  -- Mismo orden de bloqueo que apply_price_increase. Incluye productos desactivados después.
  perform 1 from public.products p
  where p.id in (select h.product_id from public.price_history h
                 where h.bulk_change_id = v_bulk.id and h.source = 'bulk_increase')
  order by p.id
  for update;

  perform set_config('app.price_change_source', 'bulk_revert', true);
  perform set_config('app.price_bulk_change_id', v_bulk.id::text, true);
  perform set_config('app.price_change_reason', trim(p_reason), true);

  for v_row in
    select h.product_id, h.old_sale_price, h.new_sale_price, p.sale_price as current_sale_price
    from public.price_history h
    join public.products p on p.id = h.product_id
    where h.bulk_change_id = v_bulk.id and h.source = 'bulk_increase'
    order by h.product_id
  loop
    -- Solo se restaura si el precio SIGUE siendo el que dejó ese aumento: nunca se pisa un precio posterior.
    if v_row.current_sale_price = v_row.new_sale_price then
      update public.products p set sale_price = v_row.old_sale_price where p.id = v_row.product_id;
      v_restored := v_restored + 1;
    else
      v_skipped := v_skipped || v_row.product_id;
    end if;
  end loop;

  perform set_config('app.price_change_source', '', true);
  perform set_config('app.price_bulk_change_id', '', true);
  perform set_config('app.price_change_reason', '', true);

  v_result := jsonb_build_object('restored', v_restored, 'skipped_product_ids', to_jsonb(v_skipped));

  update public.price_bulk_changes b
  set status = 'reverted', reverted_at = now(), reverted_by = (select auth.uid()),
      revert_reason = trim(p_reason), revert_idempotency_key = p_idempotency_key, revert_result = v_result
  where b.id = v_bulk.id;

  return v_result;
end;
$$;

comment on function public.revert_price_change(uuid, uuid, text) is
  'Deshace un aumento masivo: restaura solo lo que sigue igual (también productos desactivados) e informa lo saltado. Contrato §19.4.';

-- ---------------------------------------------------------------------------
-- 5. Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.preview_price_increase(uuid[], uuid[], uuid[], uuid[], numeric, numeric) from public, anon;
revoke all on function public.apply_price_increase(uuid, uuid[], uuid[], uuid[], uuid[], numeric, numeric, uuid[], text) from public, anon;
revoke all on function public.revert_price_change(uuid, uuid, text) from public, anon;

grant execute on function public.preview_price_increase(uuid[], uuid[], uuid[], uuid[], numeric, numeric) to authenticated;
grant execute on function public.apply_price_increase(uuid, uuid[], uuid[], uuid[], uuid[], numeric, numeric, uuid[], text) to authenticated;
grant execute on function public.revert_price_change(uuid, uuid, text) to authenticated;
