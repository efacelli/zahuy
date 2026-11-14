-- v0.4 paso E: días de alerta de vencimiento, configurables por categoría.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, secciones 4.4, 5.9 y 9.
--
-- Migración aditiva: crea una tabla nueva y su fila general (7 / 15 / 30).
-- No modifica datos existentes.

create table public.expiry_alert_settings (
  id uuid not null default gen_random_uuid(),
  -- NULL = configuración general; con valor = excepción de esa categoría.
  category_id uuid,
  urgent_days integer not null default 7,
  soon_days integer not null default 15,
  notice_days integer not null default 30,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint expiry_alert_settings_pkey primary key (id),
  constraint expiry_alert_settings_urgent_days_check check (urgent_days >= 0),
  constraint expiry_alert_settings_soon_days_check check (soon_days >= urgent_days),
  constraint expiry_alert_settings_notice_days_check check (notice_days >= soon_days and notice_days <= 365),
  constraint expiry_alert_settings_category_id_fkey foreign key (category_id) references public.categories (id) on delete restrict,
  constraint expiry_alert_settings_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint expiry_alert_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.expiry_alert_settings is
  'Días de alerta de vencimiento: una fila general (category_id nulo) y, opcionalmente, una por categoría.';

-- Una sola fila general y una sola por categoría.
create unique index expiry_alert_settings_category_key
  on public.expiry_alert_settings (coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Reglas que valen para cualquier rol:
--   * category_id no cambia (una fila general no se convierte en excepción ni
--     al revés);
--   * la fila general no se borra.
create function private.expiry_alert_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.category_id is distinct from old.category_id then
      raise exception 'expiry_alert_settings.category_id no se puede modificar'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.category_id is null then
    raise exception 'La configuración general de alertas no se puede borrar'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function private.expiry_alert_settings_guard() from public;

create trigger expiry_alert_settings_guard
  before update or delete on public.expiry_alert_settings
  for each row
  execute function private.expiry_alert_settings_guard();

create trigger expiry_alert_settings_set_audit_columns
  before insert or update on public.expiry_alert_settings
  for each row
  execute function private.set_audit_columns();

-- Altas y ediciones quedan en audit_log, como el resto de las tablas editables.
create trigger expiry_alert_settings_audit
  after insert or update on public.expiry_alert_settings
  for each row
  execute function private.write_audit_log();

alter table public.expiry_alert_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Permisos y políticas (contrato §9)
-- ---------------------------------------------------------------------------
-- Lee cualquier usuario activo; crean, editan y borran encargado y dueño.
-- El borrado es la única excepción a "no hay borrado físico": quitar la fila
-- de una categoría la devuelve a la configuración general.
revoke all on table public.expiry_alert_settings from public, anon, authenticated;

grant select, delete on table public.expiry_alert_settings to authenticated;
grant insert (category_id, urgent_days, soon_days, notice_days) on table public.expiry_alert_settings to authenticated;
grant update (urgent_days, soon_days, notice_days) on table public.expiry_alert_settings to authenticated;

create policy expiry_alert_settings_select on public.expiry_alert_settings
  for select to authenticated
  using ((select private.is_active_user()));

create policy expiry_alert_settings_insert on public.expiry_alert_settings
  for insert to authenticated
  with check ((select private.is_manager_or_admin()));

create policy expiry_alert_settings_update on public.expiry_alert_settings
  for update to authenticated
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

create policy expiry_alert_settings_delete on public.expiry_alert_settings
  for delete to authenticated
  using ((select private.is_manager_or_admin()) and category_id is not null);

-- ---------------------------------------------------------------------------
-- Fila general
-- ---------------------------------------------------------------------------
insert into public.expiry_alert_settings (category_id, urgent_days, soon_days, notice_days)
values (null, 7, 15, 30);
