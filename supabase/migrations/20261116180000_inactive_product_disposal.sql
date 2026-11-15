-- Corrección: movimientos de descarte sobre productos inactivos (contrato P-13).
-- Contrato: docs/DATA_CONTRACT.md v0.4.2, §8.2, §8.6, §8.7 y P-13.
--
-- P-13: sobre un producto inactivo se permiten solo las salidas shrinkage,
-- damage y supplier_return. La migración 20261116170000 rechazaba con
-- PRODUCT_INACTIVE cualquier tipo, así que el stock que quedaba de un producto
-- discontinuado no se podía dar de baja cuando vencía o se rompía.
--
-- Solo reemplaza el cuerpo de dos funciones (create or replace conserva sus
-- permisos). El único cambio en cada una es la condición de producto inactivo;
-- el resto es idéntico a la migración anterior. No modifica tablas ni datos.
-- private.allows_expired_batch() ya define ese mismo conjunto de tipos.

create or replace function public.register_stock_movement(
  p_idempotency_key uuid,
  p_batch_id uuid,
  p_movement_type public.movement_type,
  p_quantity numeric,
  p_reason text default null,
  p_notes text default null,
  p_occurred_at timestamptz default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.stock_movements;
  v_batch public.product_batches;
  v_product public.products;
  v_occurred_at timestamptz;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  select * into v_existing from public.stock_movements m where m.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.batch_id is not distinct from p_batch_id
       and v_existing.movement_type is not distinct from p_movement_type
       and v_existing.quantity is not distinct from p_quantity
       and v_existing.operation_key is null
       and v_existing.reverses_movement_id is null then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (select 1 from public.stock_movements m where m.operation_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if p_movement_type is null or p_movement_type = 'entry'::public.movement_type then
    perform private.raise_business_error('INVALID_MOVEMENT_TYPE');
  end if;

  select * into v_batch from public.product_batches b where b.id = p_batch_id for update;
  if not found then
    perform private.raise_business_error('BATCH_NOT_FOUND');
  end if;
  select * into v_product from public.products p where p.id = v_batch.product_id;
  if not v_product.is_active and not private.allows_expired_batch(p_movement_type) then
    perform private.raise_business_error('PRODUCT_INACTIVE');
  end if;

  perform private.assert_valid_quantity(p_quantity, v_product.sale_unit);
  perform private.assert_reason(p_movement_type, p_reason);
  v_occurred_at := private.resolve_occurred_at(p_occurred_at);

  if not private.is_inbound_movement(p_movement_type)
     and v_batch.expires_on < private.today_ar()
     and not private.allows_expired_batch(p_movement_type) then
    perform private.raise_business_error('BATCH_EXPIRED');
  end if;

  return private.apply_batch_movement(
    p_idempotency_key, null, v_batch, p_movement_type, p_quantity, p_reason, p_notes, v_occurred_at, null
  );
end;
$$;

create or replace function public.register_product_movement(
  p_idempotency_key uuid,
  p_product_id uuid,
  p_movement_type public.movement_type,
  p_quantity numeric,
  p_reason text default null,
  p_notes text default null,
  p_occurred_at timestamptz default null
)
returns setof public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_batch public.product_batches;
  v_occurred_at timestamptz;
  v_remaining numeric;
  v_take numeric;
  v_usable numeric;
  v_count int;
  v_total numeric;
  v_mismatch boolean;
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;
  if p_movement_type is distinct from 'internal_use'::public.movement_type and not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Reintento: misma clave, mismo producto, mismo tipo y misma cantidad total
  -- devuelve los movimientos ya creados.
  select count(*), coalesce(sum(m.quantity), 0),
         bool_or(m.product_id is distinct from p_product_id or m.movement_type is distinct from p_movement_type)
    into v_count, v_total, v_mismatch
  from public.stock_movements m
  where m.operation_key = p_idempotency_key;
  if v_count > 0 then
    if not v_mismatch and v_total = p_quantity then
      return query
        select m.* from public.stock_movements m
        where m.operation_key = p_idempotency_key
        order by m.created_at, m.batch_quantity_after, m.id;
      return;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (select 1 from public.stock_movements m where m.idempotency_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if p_movement_type is null or p_movement_type = 'entry'::public.movement_type then
    perform private.raise_business_error('INVALID_MOVEMENT_TYPE');
  end if;

  select * into v_product from public.products p where p.id = p_product_id;
  if not found then
    perform private.raise_business_error('PRODUCT_NOT_FOUND');
  end if;
  if not v_product.is_active and not private.allows_expired_batch(p_movement_type) then
    perform private.raise_business_error('PRODUCT_INACTIVE');
  end if;

  perform private.assert_valid_quantity(p_quantity, v_product.sale_unit);
  perform private.assert_reason(p_movement_type, p_reason);
  v_occurred_at := private.resolve_occurred_at(p_occurred_at);

  if private.is_inbound_movement(p_movement_type) then
    -- Lote con stock que vence más tarde (sin vencimiento = el más tardío);
    -- si ninguno tiene stock, el último recibido.
    select * into v_batch from public.product_batches b
    where b.product_id = p_product_id and b.quantity_available > 0
    order by b.expires_on desc nulls first, b.received_on desc, b.created_at desc, b.id desc
    limit 1
    for update;
    if not found then
      select * into v_batch from public.product_batches b
      where b.product_id = p_product_id
      order by b.received_on desc, b.created_at desc, b.id desc
      limit 1
      for update;
    end if;
    if not found then
      perform private.raise_business_error('BATCH_NOT_FOUND');
    end if;
    return next private.apply_batch_movement(
      gen_random_uuid(), p_idempotency_key, v_batch, p_movement_type, p_quantity, p_reason, p_notes, v_occurred_at, null
    );
    return;
  end if;

  -- Salida: bloquea los lotes utilizables en orden FEFO y verifica que alcancen
  -- antes de tocar nada.
  perform 1 from public.product_batches b
  where b.product_id = p_product_id and b.quantity_available > 0
  order by b.expires_on nulls last, b.received_on, b.id
  for update;

  select coalesce(sum(b.quantity_available), 0) into v_usable
  from public.product_batches b
  where b.product_id = p_product_id
    and b.quantity_available > 0
    and (private.allows_expired_batch(p_movement_type) or b.expires_on is null or b.expires_on >= private.today_ar());
  if v_usable < p_quantity then
    perform private.raise_business_error('INSUFFICIENT_STOCK');
  end if;

  v_remaining := p_quantity;
  for v_batch in
    select * from public.product_batches b
    where b.product_id = p_product_id
      and b.quantity_available > 0
      and (private.allows_expired_batch(p_movement_type) or b.expires_on is null or b.expires_on >= private.today_ar())
    order by b.expires_on nulls last, b.received_on, b.id
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_batch.quantity_available);
    return next private.apply_batch_movement(
      gen_random_uuid(), p_idempotency_key, v_batch, p_movement_type, v_take, p_reason, p_notes, v_occurred_at, null
    );
    v_remaining := v_remaining - v_take;
  end loop;

  return;
end;
$$;
