-- v0.7.1 (P-44): toda comprobación de "dueño" y de "encargado o dueño" acepta
-- también al programador. Mismas firmas, mismos permisos de ejecución; solo
-- cambia la lista de roles. No modifica ni borra datos.

create or replace function private.is_admin()
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
      and p.role in ('admin'::public.app_role, 'developer'::public.app_role)
  );
$$;

comment on function private.is_admin() is
  'true si quien consulta es un usuario activo con rol admin (dueño) o developer (programador, P-44).';

create or replace function private.is_manager_or_admin()
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
      and p.role in ('manager'::public.app_role, 'admin'::public.app_role, 'developer'::public.app_role)
  );
$$;

comment on function private.is_manager_or_admin() is
  'true si quien consulta es un usuario activo con rol manager (encargado), admin (dueño) o developer (programador, P-44).';
