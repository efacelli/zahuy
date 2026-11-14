-- Paso D: productos.
-- Contrato: docs/DATA_CONTRACT.md v0.3.1, secciones 2.3, 2.5, 2.6, 5.5 y 9.
--
-- Migración solo aditiva: crea una tabla nueva; no modifica datos existentes.
--
-- No hay columna de stock: el stock del producto es la suma de sus lotes y se
-- expone por vista (contrato §3). El alta se hace solo con la RPC
-- create_product (paso G); acá el INSERT directo queda sin permiso.

-- ---------------------------------------------------------------------------
-- 1. Permiso de gestión de inventario, en un solo lugar
-- ---------------------------------------------------------------------------
-- Contrato v0.3.1: todo usuario activo gestiona productos, lotes y
-- movimientos. Las políticas y las RPC consultan esta función en lugar de
-- repetir la regla, así un cambio futuro de permisos por rol se hace
-- reemplazando solo este cuerpo en una migración nueva.
create function private.can_manage_inventory()
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
  );
$$;

comment on function private.can_manage_inventory() is
  'true si quien consulta puede crear y editar productos, lotes y movimientos. v0.3.1: todo usuario activo.';

revoke all on function private.can_manage_inventory() from public;
grant execute on function private.can_manage_inventory() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. products (contrato §5.5)
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid not null default gen_random_uuid(),
  sku text not null,
  barcode text,
  name text not null,
  description text,
  category_id uuid not null,
  brand_id uuid not null,
  supplier_id uuid,
  sale_unit public.sale_unit not null default 'unit',
  cost_price numeric(12, 2) not null,
  sale_price numeric(12, 2) not null,
  vat_rate numeric(4, 2) not null default 21.00,
  boxes_quantity integer not null default 0,
  min_stock numeric(12, 3) not null default 0,
  is_active boolean not null default true,
  image_path text,
  creation_key uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint products_pkey primary key (id),
  constraint products_sku_check check (sku = trim(sku) and length(sku) between 1 and 40),
  constraint products_barcode_check check (barcode ~ '^[0-9]{8,14}$'),
  constraint products_name_check check (length(trim(name)) between 1 and 150),
  constraint products_cost_price_check check (cost_price >= 0),
  constraint products_sale_price_check check (sale_price >= 0),
  constraint products_vat_rate_check check (vat_rate in (10.50, 21.00)),
  constraint products_boxes_quantity_check check (boxes_quantity >= 0),
  constraint products_min_stock_check check (min_stock >= 0),
  constraint products_image_path_check check (image_path !~* '^https?://'),
  constraint products_creation_key_key unique (creation_key),
  constraint products_category_id_fkey foreign key (category_id) references public.categories (id) on delete restrict,
  constraint products_brand_id_fkey foreign key (brand_id) references public.brands (id) on delete restrict,
  constraint products_supplier_id_fkey foreign key (supplier_id) references public.suppliers (id) on delete restrict,
  constraint products_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint products_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.products is
  'Productos. Sin columna de stock: el stock es la suma de los lotes (vista v_product_stock).';
comment on column public.products.boxes_quantity is
  'Cajas cerradas en depósito, contadas a mano. Independiente del stock en unidades.';
comment on column public.products.creation_key is
  'Clave de idempotencia del alta. La escribe solo la RPC create_product.';

-- Los nombres de estos índices son parte del contrato: el frontend traduce el
-- error 23505 por nombre.
create unique index products_sku_key on public.products (upper(sku));
create unique index products_barcode_key on public.products (barcode) where barcode is not null;

-- Filtros del listado y soporte de las claves foráneas.
create index products_category_id_idx on public.products (category_id);
create index products_brand_id_idx on public.products (brand_id);
create index products_supplier_id_idx on public.products (supplier_id);

create trigger products_set_audit_columns
  before insert or update on public.products
  for each row
  execute function private.set_audit_columns();

alter table public.products enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Permisos y políticas (contrato §9)
-- ---------------------------------------------------------------------------
revoke all on table public.products from public, anon, authenticated;

grant select on table public.products to authenticated;

-- Edición directa de los datos del producto. Sin INSERT (solo create_product),
-- sin DELETE (se desactiva) y sin id, creation_key ni columnas de auditoría.
grant update (
  sku, barcode, name, description, category_id, brand_id, supplier_id, sale_unit,
  cost_price, sale_price, vat_rate, boxes_quantity, min_stock, is_active, image_path
) on table public.products to authenticated;

create policy products_select on public.products
  for select to authenticated
  using ((select private.is_active_user()));

create policy products_update on public.products
  for update to authenticated
  using ((select private.can_manage_inventory()))
  with check ((select private.can_manage_inventory()));
