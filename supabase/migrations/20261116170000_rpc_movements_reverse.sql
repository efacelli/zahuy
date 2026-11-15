-- v0.4 paso G (2 de 2): RPC de movimientos y reversión.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, secciones 4.3, 5.7, 8.2, 8.3, 8.5, 8.6, 8.7 y 9.
--
-- Solo crea funciones; no modifica tablas ni datos existentes.
-- Mismas reglas comunes que la migración 20261116160000 (SECURITY DEFINER,
-- search_path vacío, una transacción por llamada, idempotencia con bloqueo
-- consultivo, errores P0001 con el código en MESSAGE, EXECUTE solo para
-- authenticated).

-- ---------------------------------------------------------------------------
-- 1. Funciones auxiliares (esquema private)
-- ---------------------------------------------------------------------------
-- Tipos que suman stock (contrato §4.3). Mismo criterio que signed_quantity.
create function private.is_inbound_movement(p_type public.movement_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in (
    'entry'::public.movement_type,
    'adjustment_in'::public.movement_type,
    'customer_return'::public.movement_type
  );
$$;

-- Tipos de salida que sí pueden usar lotes vencidos (contrato P-15).
create function private.allows_expired_batch(p_type public.movement_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in (
    'shrinkage'::public.movement_type,
    'damage'::public.movement_type,
    'supplier_return'::public.movement_type
  );
$$;

-- Motivo obligatorio (no vacío) para todo tipo salvo entry y exit (§4.3).
create function private.assert_reason(p_type public.movement_type, p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_type not in ('entry'::public.movement_type, 'exit'::public.movement_type)
     and coalesce(length(trim(p_reason)), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;
end;
$$;

-- Fecha del movimiento (P-11): nula = now(); no futura (5 minutos de
-- tolerancia por relojes) ni con más de 7 días de atraso.
create function private.resolve_occurred_at(p_occurred_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_occurred_at is null then
    return now();
  end if;
  if p_occurred_at > now() + interval '5 minutes' or p_occurred_at < now() - interval '7 days' then
    raise exception using errcode = 'P0001', message = 'INVALID_DATE';
  end if;
  return p_occurred_at;
end;
$$;

-- Aplica un movimiento sobre un lote ya bloqueado (FOR UPDATE): actualiza el
-- saldo e inserta el movimiento. Quien llama ya validó todo lo de negocio.
create function private.apply_batch_movement(
  p_idempotency_key uuid,
  p_operation_key uuid,
  p_batch public.product_batches,
  p_type public.movement_type,
  p_quantity numeric,
  p_reason text,
  p_notes text,
  p_occurred_at timestamptz,
  p_reverses_movement_id uuid
)
returns public.stock_movements
language plpgsql
set search_path = ''
as $$
declare
  v_after numeric;
  v_movement public.stock_movements;
begin
  v_after := p_batch.quantity_available
    + case when private.is_inbound_movement(p_type) then p_quantity else -p_quantity end;
  if v_after < 0 then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_STOCK';
  end if;

  update public.product_batches b set quantity_available = v_after where b.id = p_batch.id;

  insert into public.stock_movements (
    idempotency_key, operation_key, product_id, batch_id, movement_type, quantity, batch_quantity_after,
    reason, notes, reverses_movement_id, occurred_at, created_by
  )
  values (
    p_idempotency_key, p_operation_key, p_batch.product_id, p_batch.id, p_type, p_quantity, v_after,
    nullif(trim(p_reason), ''), nullif(trim(p_notes), ''), p_reverses_movement_id, p_occurred_at, (select auth.uid())
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function private.is_inbound_movement(public.movement_type) from public;
revoke all on function private.allows_expired_batch(public.movement_type) from public;
revoke all on function private.assert_reason(public.movement_type, text) from public;
revoke all on function private.resolve_occurred_at(timestamptz) from public;
revoke all on function private.apply_batch_movement(
  uuid, uuid, public.product_batches, public.movement_type, numeric, text, text, timestamptz, uuid
) from public;

-- ---------------------------------------------------------------------------
-- 2. register_stock_movement (contrato §8.2): movimiento sobre un lote elegido
-- ---------------------------------------------------------------------------
-- Correcciones puntuales sobre un lote. Solo encargado y dueño.
create function public.register_stock_movement(
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
  if not v_product.is_active then
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

comment on function public.register_stock_movement(uuid, uuid, public.movement_type, numeric, text, text, timestamptz) is
  'Movimiento sobre un lote elegido (corrección puntual). Solo encargado y dueño. Contrato §8.2.';

-- ---------------------------------------------------------------------------
-- 3. register_product_movement (contrato §8.7): por producto, lotes FEFO
-- ---------------------------------------------------------------------------
-- Salidas: descuenta de los lotes en orden de vencimiento; puede generar un
-- movimiento por lote, todos con operation_key = p_idempotency_key.
-- Entradas: van al lote con stock que vence más tarde.
-- El empleado solo puede usar internal_use.
create function public.register_product_movement(
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
  if not v_product.is_active then
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

comment on function public.register_product_movement(uuid, uuid, public.movement_type, numeric, text, text, timestamptz) is
  'Salida o entrada por producto; elige los lotes por vencimiento (FEFO). El empleado solo internal_use. Contrato §8.7.';

-- ---------------------------------------------------------------------------
-- 4. reverse_stock_movement (contrato §8.3)
-- ---------------------------------------------------------------------------
-- Movimiento compensatorio con reverses_movement_id. Solo encargado y dueño.
-- No aplica BATCH_EXPIRED ni PRODUCT_INACTIVE.
create function public.reverse_stock_movement(
  p_idempotency_key uuid,
  p_movement_id uuid,
  p_reason text
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.stock_movements;
  v_original public.stock_movements;
  v_batch public.product_batches;
  v_type public.movement_type;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  select * into v_existing from public.stock_movements m where m.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.reverses_movement_id is not distinct from p_movement_id then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (select 1 from public.stock_movements m where m.operation_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform private.raise_business_error('REASON_REQUIRED');
  end if;

  select * into v_original from public.stock_movements m where m.id = p_movement_id;
  if not found then
    perform private.raise_business_error('MOVEMENT_NOT_FOUND');
  end if;
  if v_original.reverses_movement_id is not null then
    perform private.raise_business_error('INVALID_MOVEMENT_TYPE');
  end if;

  -- El bloqueo del lote serializa dos anulaciones simultáneas del mismo movimiento.
  select * into v_batch from public.product_batches b where b.id = v_original.batch_id for update;

  if exists (select 1 from public.stock_movements m where m.reverses_movement_id = p_movement_id) then
    perform private.raise_business_error('ALREADY_REVERSED');
  end if;

  v_type := case
    when private.is_inbound_movement(v_original.movement_type) then 'adjustment_out'::public.movement_type
    else 'adjustment_in'::public.movement_type
  end;

  return private.apply_batch_movement(
    p_idempotency_key, null, v_batch, v_type, v_original.quantity, p_reason, null, now(), v_original.id
  );
end;
$$;

comment on function public.reverse_stock_movement(uuid, uuid, text) is
  'Anula un movimiento con uno compensatorio (adjustment_in/out). Solo encargado y dueño. Contrato §8.3.';

-- ---------------------------------------------------------------------------
-- 5. Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.register_stock_movement(uuid, uuid, public.movement_type, numeric, text, text, timestamptz)
  from public, anon;
revoke all on function public.register_product_movement(uuid, uuid, public.movement_type, numeric, text, text, timestamptz)
  from public, anon;
revoke all on function public.reverse_stock_movement(uuid, uuid, text) from public, anon;

grant execute on function public.register_stock_movement(uuid, uuid, public.movement_type, numeric, text, text, timestamptz)
  to authenticated;
grant execute on function public.register_product_movement(uuid, uuid, public.movement_type, numeric, text, text, timestamptz)
  to authenticated;
grant execute on function public.reverse_stock_movement(uuid, uuid, text) to authenticated;
