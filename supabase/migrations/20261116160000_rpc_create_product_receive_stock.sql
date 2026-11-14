-- v0.4 paso G (1 de 2): RPC de alta de producto e ingreso de mercadería.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, secciones 8, 8.1, 8.4, 8.5, 8.6 y 9.
--
-- Solo crea funciones; no modifica datos existentes.
--
-- Reglas comunes de las RPC:
--   * SECURITY DEFINER con search_path vacío y nombres calificados;
--   * validan sesión, perfil activo y rol dentro de la función;
--   * una llamada = una transacción: o se guarda todo o nada;
--   * idempotentes: la clave que envía el cliente se serializa con un bloqueo
--     consultivo, así dos reintentos simultáneos no duplican nada;
--   * errores de negocio: ERRCODE 'P0001' con el código en MESSAGE (§8.6);
--   * EXECUTE solo para authenticated.

-- ---------------------------------------------------------------------------
-- 1. Funciones auxiliares (esquema private, no expuestas por la API)
-- ---------------------------------------------------------------------------
create function private.raise_business_error(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end;
$$;

-- Serializa las llamadas que comparten clave de idempotencia. El bloqueo se
-- libera solo al terminar la transacción.
create function private.lock_idempotency_key(p_key uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null then
    raise exception 'p_idempotency_key es obligatorio' using errcode = '23502';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key::text, 0));
end;
$$;

-- Cantidad válida para la unidad de venta del producto (contrato §4.2):
-- mayor que cero, hasta 3 decimales, y entera para unit, pack, box y other.
create function private.assert_valid_quantity(p_quantity numeric, p_sale_unit public.sale_unit)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_quantity is null
     or p_quantity <= 0
     or p_quantity > 999999999.999
     or p_quantity <> round(p_quantity, 3)
     or (p_sale_unit not in ('kg'::public.sale_unit, 'l'::public.sale_unit) and p_quantity <> trunc(p_quantity)) then
    raise exception using errcode = 'P0001', message = 'INVALID_QUANTITY';
  end if;
end;
$$;

-- Fecha de ingreso: nula = hoy en Buenos Aires; nunca futura.
create function private.resolve_received_on(p_received_on date)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := private.today_ar();
  v_received_on date := coalesce(p_received_on, v_today);
begin
  if v_received_on > v_today then
    raise exception using errcode = 'P0001', message = 'INVALID_DATE';
  end if;
  return v_received_on;
end;
$$;

-- Crea un lote y su movimiento de ingreso (entry). Único lugar donde nace
-- stock: lo usan receive_stock y create_product.
create function private.create_batch_with_entry(
  p_idempotency_key uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_received_on date,
  p_expires_on date,
  p_batch_number text,
  p_notes text
)
returns public.stock_movements
language plpgsql
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_movement public.stock_movements;
begin
  insert into public.product_batches (
    product_id, batch_number, received_on, expires_on, quantity_initial, quantity_available, notes
  )
  values (
    p_product_id, nullif(trim(p_batch_number), ''), p_received_on, p_expires_on, p_quantity, p_quantity,
    nullif(trim(p_notes), '')
  )
  returning id into v_batch_id;

  insert into public.stock_movements (
    idempotency_key, product_id, batch_id, movement_type, quantity, batch_quantity_after, notes, created_by
  )
  values (
    p_idempotency_key, p_product_id, v_batch_id, 'entry'::public.movement_type, p_quantity, p_quantity,
    nullif(trim(p_notes), ''), (select auth.uid())
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

revoke all on function private.raise_business_error(text) from public;
revoke all on function private.lock_idempotency_key(uuid) from public;
revoke all on function private.assert_valid_quantity(numeric, public.sale_unit) from public;
revoke all on function private.resolve_received_on(date) from public;
revoke all on function private.create_batch_with_entry(uuid, uuid, numeric, date, date, text, text) from public;

-- ---------------------------------------------------------------------------
-- 2. receive_stock (contrato §8.1): ingreso con lote nuevo
-- ---------------------------------------------------------------------------
-- Pueden usarla todos los usuarios activos. La cantidad va siempre en
-- unidades de venta. El vencimiento es obligatorio.
create function public.receive_stock(
  p_idempotency_key uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_received_on date default null,
  p_expires_on date default null,
  p_batch_number text default null,
  p_notes text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.stock_movements;
  v_product public.products;
  v_received_on date;
begin
  if not private.is_active_user() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Reintento: misma clave con los mismos datos devuelve el movimiento ya creado.
  select * into v_existing from public.stock_movements m where m.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.movement_type = 'entry'::public.movement_type
       and v_existing.product_id is not distinct from p_product_id
       and v_existing.quantity is not distinct from p_quantity
       and not exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
      return v_existing;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  if exists (select 1 from public.stock_movements m where m.operation_key = p_idempotency_key)
     or exists (select 1 from public.products p where p.creation_key = p_idempotency_key) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  select * into v_product from public.products p where p.id = p_product_id;
  if not found then
    perform private.raise_business_error('PRODUCT_NOT_FOUND');
  end if;
  if not v_product.is_active then
    perform private.raise_business_error('PRODUCT_INACTIVE');
  end if;

  perform private.assert_valid_quantity(p_quantity, v_product.sale_unit);
  v_received_on := private.resolve_received_on(p_received_on);
  if p_expires_on is null then
    perform private.raise_business_error('EXPIRY_REQUIRED');
  end if;

  return private.create_batch_with_entry(
    p_idempotency_key, v_product.id, p_quantity, v_received_on, p_expires_on, p_batch_number, p_notes
  );
end;
$$;

comment on function public.receive_stock(uuid, uuid, numeric, date, date, text, text) is
  'Ingreso de mercadería: crea un lote y su movimiento entry. Todo usuario activo. Contrato §8.1.';

-- ---------------------------------------------------------------------------
-- 3. create_product (contrato §8.4): alta con stock inicial opcional
-- ---------------------------------------------------------------------------
-- Única forma de dar de alta un producto. Solo encargado y dueño. El SKU lo
-- asigna la base. Un reintento con la misma clave y el mismo nombre devuelve
-- el producto ya creado y no consume otro número de SKU.
create function public.create_product(
  p_idempotency_key uuid,
  p_name text,
  p_category_id uuid,
  p_brand_id uuid,
  p_sale_unit public.sale_unit,
  p_cost_price numeric,
  p_sale_price numeric,
  p_vat_rate numeric,
  p_barcode text default null,
  p_description text default null,
  p_supplier_id uuid default null,
  p_boxes_quantity integer default 0,
  p_units_per_box integer default 12,
  p_min_stock numeric default 0,
  p_is_active boolean default true,
  p_image_path text default null,
  p_initial_quantity numeric default null,
  p_received_on date default null,
  p_expires_on date default null,
  p_batch_number text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_sale_unit public.sale_unit := coalesce(p_sale_unit, 'unit'::public.sale_unit);
  v_has_stock boolean := coalesce(p_initial_quantity, 0) <> 0;
  v_received_on date;
begin
  if not private.is_manager_or_admin() then
    perform private.raise_business_error('NOT_AUTHORIZED');
  end if;

  perform private.lock_idempotency_key(p_idempotency_key);

  -- Reintento: misma clave y mismo nombre devuelve el producto ya creado.
  select * into v_product from public.products p where p.creation_key = p_idempotency_key;
  if found then
    if lower(trim(v_product.name)) = lower(trim(coalesce(p_name, ''))) then
      return v_product;
    end if;
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;
  -- La clave ya se usó en otra operación de stock.
  if exists (
    select 1 from public.stock_movements m
    where m.idempotency_key = p_idempotency_key or m.operation_key = p_idempotency_key
  ) then
    perform private.raise_business_error('IDEMPOTENCY_CONFLICT');
  end if;

  -- Se valida todo lo del stock inicial antes de crear el producto, para no
  -- consumir un número de SKU en un alta que va a fallar.
  if v_has_stock then
    perform private.assert_valid_quantity(p_initial_quantity, v_sale_unit);
    v_received_on := private.resolve_received_on(p_received_on);
    if p_expires_on is null then
      perform private.raise_business_error('EXPIRY_REQUIRED');
    end if;
  end if;

  insert into public.products (
    name, barcode, description, category_id, brand_id, supplier_id, sale_unit, cost_price, sale_price, vat_rate,
    boxes_quantity, units_per_box, min_stock, is_active, image_path, creation_key
  )
  values (
    trim(p_name), nullif(trim(p_barcode), ''), nullif(trim(p_description), ''), p_category_id, p_brand_id,
    p_supplier_id, v_sale_unit, p_cost_price, p_sale_price, p_vat_rate,
    coalesce(p_boxes_quantity, 0), coalesce(p_units_per_box, 12), coalesce(p_min_stock, 0),
    coalesce(p_is_active, true), nullif(trim(p_image_path), ''), p_idempotency_key
  )
  returning * into v_product;

  if v_has_stock then
    perform private.create_batch_with_entry(
      p_idempotency_key, v_product.id, p_initial_quantity, v_received_on, p_expires_on, p_batch_number, null
    );
  end if;

  return v_product;
end;
$$;

comment on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text
) is
  'Alta de producto con stock inicial opcional. Solo encargado y dueño. El SKU lo genera la base. Contrato §8.4.';

-- ---------------------------------------------------------------------------
-- 4. Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.receive_stock(uuid, uuid, numeric, date, date, text, text) from public, anon;
revoke all on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text
) from public, anon;

grant execute on function public.receive_stock(uuid, uuid, numeric, date, date, text, text) to authenticated;
grant execute on function public.create_product(
  uuid, text, uuid, uuid, public.sale_unit, numeric, numeric, numeric, text, text, uuid, integer, integer, numeric,
  boolean, text, numeric, date, date, text
) to authenticated;
