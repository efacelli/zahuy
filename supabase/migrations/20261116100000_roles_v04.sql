-- v0.4 paso A: permisos por rol y transición de enums.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, secciones 4.1, 4.3, 4.4, 8.8 y 9.
--
-- No modifica ni borra datos. Cambia quién puede escribir:
--   * catálogos y edición de productos y lotes: solo encargado y dueño;
--   * el empleado sigue leyendo todo y solo actualiza boxes_quantity.
-- Los perfiles existentes conservan su rol (los nuevos nacen como staff): tras
-- aplicar esta migración, quien deba gestionar el inventario necesita rol
-- manager o admin.

-- ---------------------------------------------------------------------------
-- 1. Funciones de autorización
-- ---------------------------------------------------------------------------
create function private.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role in ('manager'::public.app_role, 'admin'::public.app_role)
  );
$$;

comment on function private.is_manager_or_admin() is
  'true si quien consulta es un usuario activo con rol manager (encargado) o admin (dueño).';

revoke all on function private.is_manager_or_admin() from public;
grant execute on function private.is_manager_or_admin() to authenticated, service_role;

-- Punto único del permiso de gestión de inventario (creado en la migración de
-- products). v0.3.1: todo usuario activo. v0.4.0: encargado o dueño.
create or replace function private.can_manage_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_manager_or_admin();
$$;

comment on function private.can_manage_inventory() is
  'true si quien consulta puede crear y editar productos, lotes y movimientos. v0.4.0: encargado o dueño.';

-- ---------------------------------------------------------------------------
-- 2. Catálogos: solo escriben encargado y dueño
-- ---------------------------------------------------------------------------
-- Las políticas de lectura no cambian (todo usuario activo).
alter policy categories_insert on public.categories
  with check ((select private.is_manager_or_admin()));
alter policy categories_update on public.categories
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

alter policy brands_insert on public.brands
  with check ((select private.is_manager_or_admin()));
alter policy brands_update on public.brands
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

alter policy suppliers_insert on public.suppliers
  with check ((select private.is_manager_or_admin()));
alter policy suppliers_update on public.suppliers
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

-- ---------------------------------------------------------------------------
-- 3. Productos: el empleado solo actualiza el conteo de cajas
-- ---------------------------------------------------------------------------
-- El GRANT por columna vale para todo el rol de base "authenticated", así que
-- no alcanza para distinguir al empleado del encargado. Se resuelve con:
--   * una política de UPDATE para cualquier usuario activo, y
--   * un trigger que, si quien edita no es encargado ni dueño, rechaza
--     cualquier cambio que no sea boxes_quantity.
alter policy products_update on public.products
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));

create function private.products_restrict_staff_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Sin sesión de usuario (semilla, migración, rol privilegiado): sin restricción.
  if (select auth.uid()) is null or private.is_manager_or_admin() then
    return new;
  end if;

  if (to_jsonb(new) - 'boxes_quantity' - 'updated_at' - 'updated_by')
     is distinct from
     (to_jsonb(old) - 'boxes_quantity' - 'updated_at' - 'updated_by') then
    raise exception using errcode = 'P0001', message = 'NOT_AUTHORIZED';
  end if;

  return new;
end;
$$;

comment on function private.products_restrict_staff_update() is
  'Un usuario que no es encargado ni dueño solo puede cambiar products.boxes_quantity.';

revoke all on function private.products_restrict_staff_update() from public;

create trigger products_restrict_staff_update
  before update on public.products
  for each row
  execute function private.products_restrict_staff_update();

-- product_batches_update ya consulta private.can_manage_inventory(): desde
-- esta migración solo encargado y dueño editan los datos de un lote.

-- ---------------------------------------------------------------------------
-- 4. Enums (contrato §8.8)
-- ---------------------------------------------------------------------------
-- Consumo interno: es una salida, como todo tipo que no está en la lista de
-- entradas de stock_movements.signed_quantity; exige motivo por el CHECK
-- existente.
alter type public.movement_type add value if not exists 'internal_use';

-- Los días de alerta pasan a ser configurables por categoría: los estados
-- dejan de llevar el número en el nombre. Ninguna tabla guarda este enum.
alter type public.expiry_status rename value 'expires_7' to 'expires_urgent';
alter type public.expiry_status rename value 'expires_15' to 'expires_soon';
alter type public.expiry_status rename value 'expires_30' to 'expires_upcoming';
