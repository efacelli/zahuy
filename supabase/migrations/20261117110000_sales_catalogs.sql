-- Etapa 5 (ventas y caja), paso 2 de 5: enums y catálogos de ventas.
-- Contrato: docs/DATA_CONTRACT.md v0.6.1, §15.2, §15.3.1, §15.3.2, §15.3.8 y §15.7.
--
-- Migración aditiva: crea enums y tres tablas nuevas con sus filas iniciales
-- (5 medios de pago, Caja 1 y Caja 2, múltiplo de redondeo 100) y recrea el
-- CHECK del motivo de stock_movements para que `sale` no lo exija. Las filas
-- existentes de stock_movements ya cumplen el CHECK nuevo (es más permisivo).
--
-- NOTA para la restauración de backups: estas tres tablas se siembran acá; ver
-- v_seeded en supabase/scripts/restore-prepare.sql.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.sale_status as enum ('completed', 'voided');
create type public.cash_session_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------------
-- 2. Motivo de stock: `sale` no lo exige (como entry y exit)
-- ---------------------------------------------------------------------------
alter table public.stock_movements drop constraint stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check check (
  movement_type in (
    'entry'::public.movement_type,
    'exit'::public.movement_type,
    'sale'::public.movement_type
  )
  or coalesce(length(trim(reason)), 0) > 0
);

create or replace function private.assert_reason(p_type public.movement_type, p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_type not in ('entry'::public.movement_type, 'exit'::public.movement_type, 'sale'::public.movement_type)
     and coalesce(length(trim(p_reason)), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. payment_methods (contrato §15.3.1)
-- ---------------------------------------------------------------------------
create table public.payment_methods (
  id uuid not null default gen_random_uuid(),
  code text not null,
  name text not null,
  is_cash boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint payment_methods_pkey primary key (id),
  constraint payment_methods_code_key unique (code),
  constraint payment_methods_code_check check (code ~ '^[a-z_]{2,20}$'),
  constraint payment_methods_name_check check (length(trim(name)) between 1 and 40),
  constraint payment_methods_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint payment_methods_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.payment_methods is
  'Medios de pago. Solo uno es efectivo (is_cash): admite vuelto y entra en el arqueo.';

-- Un solo medio es efectivo.
create unique index payment_methods_one_cash_key on public.payment_methods (is_cash) where is_cash;

-- `code` e `is_cash` no cambian una vez creados: el código y el arqueo dependen de ellos.
create function private.payment_methods_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los medios de pago no se borran: se desactivan' using errcode = '42501';
  end if;
  if new.code is distinct from old.code or new.is_cash is distinct from old.is_cash then
    raise exception 'payment_methods.code y is_cash no se pueden modificar' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.payment_methods_guard() from public;

create trigger payment_methods_guard
  before update or delete on public.payment_methods
  for each row execute function private.payment_methods_guard();
create trigger payment_methods_set_audit_columns
  before insert or update on public.payment_methods
  for each row execute function private.set_audit_columns();
create trigger payment_methods_audit
  after insert or update on public.payment_methods
  for each row execute function private.write_audit_log();

alter table public.payment_methods enable row level security;

revoke all on table public.payment_methods from public, anon, authenticated;
grant select on table public.payment_methods to authenticated;
grant insert (code, name, is_cash, is_active, sort_order) on table public.payment_methods to authenticated;
grant update (name, is_active, sort_order) on table public.payment_methods to authenticated;

create policy payment_methods_select on public.payment_methods
  for select to authenticated using ((select private.is_active_user()));
create policy payment_methods_insert on public.payment_methods
  for insert to authenticated with check ((select private.is_manager_or_admin()));
create policy payment_methods_update on public.payment_methods
  for update to authenticated
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

insert into public.payment_methods (code, name, is_cash, sort_order) values
  ('cash', 'Efectivo', true, 1),
  ('debit', 'Débito', false, 2),
  ('credit', 'Crédito', false, 3),
  ('qr', 'QR', false, 4),
  ('transfer', 'Transferencia', false, 5);

-- ---------------------------------------------------------------------------
-- 4. cash_registers (contrato §15.3.2)
-- ---------------------------------------------------------------------------
create table public.cash_registers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint cash_registers_pkey primary key (id),
  constraint cash_registers_name_check check (length(trim(name)) between 1 and 40),
  constraint cash_registers_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint cash_registers_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.cash_registers is 'Cajas físicas del local (2 cobrando a la vez, respuesta 38).';

create unique index cash_registers_name_key on public.cash_registers (lower(private.unaccent_text(trim(name))));

create trigger cash_registers_no_delete
  before delete on public.cash_registers
  for each row execute function private.reject_modification();
create trigger cash_registers_set_audit_columns
  before insert or update on public.cash_registers
  for each row execute function private.set_audit_columns();
create trigger cash_registers_audit
  after insert or update on public.cash_registers
  for each row execute function private.write_audit_log();

alter table public.cash_registers enable row level security;

revoke all on table public.cash_registers from public, anon, authenticated;
grant select on table public.cash_registers to authenticated;
grant insert (name, is_active) on table public.cash_registers to authenticated;
grant update (name, is_active) on table public.cash_registers to authenticated;

create policy cash_registers_select on public.cash_registers
  for select to authenticated using ((select private.is_active_user()));
create policy cash_registers_insert on public.cash_registers
  for insert to authenticated with check ((select private.is_manager_or_admin()));
create policy cash_registers_update on public.cash_registers
  for update to authenticated
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

insert into public.cash_registers (name) values ('Caja 1'), ('Caja 2');

-- ---------------------------------------------------------------------------
-- 5. sales_settings (contrato §15.3.8): una sola fila
-- ---------------------------------------------------------------------------
create table public.sales_settings (
  id uuid not null default gen_random_uuid(),
  cash_rounding_multiple numeric(12, 2) not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint sales_settings_pkey primary key (id),
  constraint sales_settings_cash_rounding_multiple_check check (cash_rounding_multiple > 0),
  constraint sales_settings_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint sales_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete restrict
);

comment on table public.sales_settings is
  'Configuración de ventas (una sola fila). Hoy: múltiplo del redondeo del efectivo (P-30).';

create unique index sales_settings_singleton_key on public.sales_settings ((true));

create trigger sales_settings_no_delete
  before delete on public.sales_settings
  for each row execute function private.reject_modification();
create trigger sales_settings_set_audit_columns
  before insert or update on public.sales_settings
  for each row execute function private.set_audit_columns();
create trigger sales_settings_audit
  after insert or update on public.sales_settings
  for each row execute function private.write_audit_log();

alter table public.sales_settings enable row level security;

revoke all on table public.sales_settings from public, anon, authenticated;
grant select on table public.sales_settings to authenticated;
grant update (cash_rounding_multiple) on table public.sales_settings to authenticated;

create policy sales_settings_select on public.sales_settings
  for select to authenticated using ((select private.is_active_user()));
create policy sales_settings_update on public.sales_settings
  for update to authenticated
  using ((select private.is_manager_or_admin()))
  with check ((select private.is_manager_or_admin()));

insert into public.sales_settings (cash_rounding_multiple) values (100);
