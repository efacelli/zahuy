-- Paso B: privilegios por defecto, enums y perfiles de usuario.
-- Contrato: docs/DATA_CONTRACT.md v0.3.1, secciones 2.4, 4, 5.1 y 9.
--
-- Migración solo aditiva: no modifica ni borra datos existentes.
-- Filas previas: si ya hay usuarios en auth.users, se les crea su perfil
-- (rol staff, activo) al final de este archivo.

-- ---------------------------------------------------------------------------
-- 1. Privilegios por defecto: nada queda expuesto sin un GRANT explícito
-- ---------------------------------------------------------------------------
-- Supabase otorga por defecto todos los permisos sobre los objetos nuevos de
-- "public" a anon y authenticated, y deja la RLS como única barrera. Acá se
-- invierte: cada tabla, vista o función nueva nace sin permisos para esos
-- roles y cada migración otorga solo lo que el contrato indica.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- Esquema para funciones auxiliares. No está en la lista de esquemas de la
-- API, así que no se puede invocar por RPC desde el navegador.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Enums (contrato §4)
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'manager', 'staff');

create type public.sale_unit as enum ('unit', 'kg', 'l', 'pack', 'box', 'other');

create type public.movement_type as enum (
  'entry',
  'exit',
  'adjustment_in',
  'adjustment_out',
  'shrinkage',
  'damage',
  'customer_return',
  'supplier_return'
);

-- Solo se usa en vistas; no se guarda en ninguna tabla.
create type public.expiry_status as enum (
  'depleted',
  'no_expiry',
  'expired',
  'expires_7',
  'expires_15',
  'expires_30',
  'ok'
);

-- ---------------------------------------------------------------------------
-- 3. "Hoy" en la zona horaria del local (contrato §2.4)
-- ---------------------------------------------------------------------------
create function private.today_ar()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

comment on function private.today_ar() is
  'Fecha de hoy en America/Argentina/Buenos_Aires. Usar en lugar de current_date.';

-- ---------------------------------------------------------------------------
-- 4. Tabla profiles (contrato §5.1)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid not null,
  full_name text not null,
  role public.app_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete restrict,
  constraint profiles_full_name_check check (length(trim(full_name)) between 1 and 120)
);

comment on table public.profiles is
  'Una fila por usuario de Supabase Auth. La crea un trigger; el usuario no elige su rol.';

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Funciones de autorización
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para poder leer profiles desde las políticas de la propia
-- tabla sin recursión de RLS. search_path vacío y nombres calificados.
create function private.is_active_user()
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

comment on function private.is_active_user() is
  'true si quien consulta tiene sesión, perfil y está activo.';

create function private.is_admin()
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
      and p.role = 'admin'::public.app_role
  );
$$;

comment on function private.is_admin() is
  'true si quien consulta es un usuario activo con rol admin.';

-- ---------------------------------------------------------------------------
-- 6. Alta automática del perfil al crear un usuario
-- ---------------------------------------------------------------------------
-- El nombre sale de los metadatos o del email. El rol NUNCA se lee de los
-- metadatos (el usuario puede modificarlos): siempre nace como staff.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
        'Usuario'
      ),
      120
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. Protección de rol y estado en cada UPDATE
-- ---------------------------------------------------------------------------
-- Segunda barrera además de la RLS:
--   * id y created_at no cambian; updated_at lo fija la base.
--   * role e is_active solo los cambia un admin, o un rol privilegiado de la
--     base sin sesión de usuario (editor SQL, semilla): así nace el primer
--     admin.
--   * un admin no puede quitarse a sí mismo el rol ni desactivarse.
create function private.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    if v_uid is not null then
      if not private.is_admin() then
        raise exception using errcode = 'P0001', message = 'NOT_AUTHORIZED';
      end if;
      if v_uid = old.id then
        raise exception using errcode = 'P0001', message = 'NOT_AUTHORIZED';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row
  execute function private.profiles_before_update();

-- ---------------------------------------------------------------------------
-- 8. Permisos y políticas (contrato §9)
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, role, is_active) on table public.profiles to authenticated;
-- Sin INSERT ni DELETE: el perfil lo crea el trigger y nunca se borra.

-- Usuario activo: lee todos los perfiles (el historial muestra quién hizo cada
-- cosa). Usuario inactivo: solo el propio.
create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_active_user())
  );

create policy profiles_update_admin on public.profiles
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on function private.today_ar() from public;
revoke all on function private.is_active_user() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.handle_new_user() from public;
revoke all on function private.profiles_before_update() from public;

grant execute on function private.today_ar() to authenticated, service_role;
grant execute on function private.is_active_user() to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Filas preexistentes
-- ---------------------------------------------------------------------------
-- Si el proyecto ya tenía usuarios antes de esta migración, se les crea el
-- perfil con las mismas reglas que el trigger.
insert into public.profiles (id, full_name)
select
  u.id,
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(split_part(coalesce(u.email, ''), '@', 1)), ''),
      'Usuario'
    ),
    120
  )
from auth.users u
on conflict (id) do nothing;
