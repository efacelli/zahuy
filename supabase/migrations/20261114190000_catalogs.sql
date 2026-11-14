-- Paso C: catálogos (categorías, marcas y proveedores).
-- Contrato: docs/DATA_CONTRACT.md v0.3.1, secciones 2.5, 2.6, 5.2, 5.3, 5.4 y 9.
--
-- Migración solo aditiva: crea tablas nuevas; no modifica datos existentes.

-- ---------------------------------------------------------------------------
-- 1. Columnas de auditoría fijadas por la base (contrato §2.5)
-- ---------------------------------------------------------------------------
-- Trigger común a todas las tablas editables. El cliente no puede escribir
-- estas columnas (tampoco tiene permiso por columna); con una sesión de
-- usuario se registra auth.uid(), y sin sesión (semilla, migración) queda NULL.
create function private.set_audit_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := v_uid;
    new.updated_at := now();
    new.updated_by := v_uid;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := v_uid;
  end if;
  return new;
end;
$$;

comment on function private.set_audit_columns() is
  'Fija created_*/updated_* en cada INSERT y UPDATE. No confía en valores del cliente.';

revoke all on function private.set_audit_columns() from public;

-- ---------------------------------------------------------------------------
-- 2. categories (contrato §5.2)
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint categories_pkey primary key (id),
  constraint categories_name_check check (length(trim(name)) between 1 and 80),
  constraint categories_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint categories_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

-- El nombre del índice es parte del contrato: el frontend traduce el error
-- 23505 por este nombre.
create unique index categories_name_key on public.categories (lower(trim(name)));

create trigger categories_set_audit_columns
  before insert or update on public.categories
  for each row
  execute function private.set_audit_columns();

alter table public.categories enable row level security;

-- ---------------------------------------------------------------------------
-- 3. brands (contrato §5.3)
-- ---------------------------------------------------------------------------
create table public.brands (
  id uuid not null default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint brands_pkey primary key (id),
  constraint brands_name_check check (length(trim(name)) between 1 and 80),
  constraint brands_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint brands_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

create unique index brands_name_key on public.brands (lower(trim(name)));

create trigger brands_set_audit_columns
  before insert or update on public.brands
  for each row
  execute function private.set_audit_columns();

alter table public.brands enable row level security;

-- ---------------------------------------------------------------------------
-- 4. suppliers (contrato §5.4)
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  tax_id text,
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint suppliers_pkey primary key (id),
  constraint suppliers_name_check check (length(trim(name)) between 1 and 120),
  constraint suppliers_tax_id_check check (tax_id ~ '^[0-9]{11}$'),
  constraint suppliers_phone_check check (length(phone) <= 40),
  constraint suppliers_email_check check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint suppliers_notes_check check (length(notes) <= 1000),
  constraint suppliers_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint suppliers_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

create unique index suppliers_name_key on public.suppliers (lower(trim(name)));
create unique index suppliers_tax_id_key on public.suppliers (tax_id) where tax_id is not null;

create trigger suppliers_set_audit_columns
  before insert or update on public.suppliers
  for each row
  execute function private.set_audit_columns();

alter table public.suppliers enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Permisos y políticas (contrato §9)
-- ---------------------------------------------------------------------------
-- Todo usuario activo lee, crea y edita. Nadie borra: se desactiva con
-- is_active = false. Los permisos de escritura son por columna, así que
-- id, created_* y updated_* no se pueden enviar desde el cliente.
revoke all on table public.categories, public.brands, public.suppliers from public, anon, authenticated;

grant select on table public.categories, public.brands, public.suppliers to authenticated;

grant insert (name, is_active), update (name, is_active)
  on table public.categories to authenticated;
grant insert (name, is_active), update (name, is_active)
  on table public.brands to authenticated;
grant insert (name, tax_id, phone, email, notes, is_active),
      update (name, tax_id, phone, email, notes, is_active)
  on table public.suppliers to authenticated;

create policy categories_select on public.categories
  for select to authenticated
  using ((select private.is_active_user()));
create policy categories_insert on public.categories
  for insert to authenticated
  with check ((select private.is_active_user()));
create policy categories_update on public.categories
  for update to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));

create policy brands_select on public.brands
  for select to authenticated
  using ((select private.is_active_user()));
create policy brands_insert on public.brands
  for insert to authenticated
  with check ((select private.is_active_user()));
create policy brands_update on public.brands
  for update to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));

create policy suppliers_select on public.suppliers
  for select to authenticated
  using ((select private.is_active_user()));
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check ((select private.is_active_user()));
create policy suppliers_update on public.suppliers
  for update to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));
