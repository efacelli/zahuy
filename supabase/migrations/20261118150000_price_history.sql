-- Historial de precios y aumentos masivos (contrato v0.9.x, §19), paso 1 de 2: tablas y trigger.
--
-- Migración ADITIVA: crea dos tablas nuevas (price_bulk_changes y price_history) y un trigger en
-- products que SOLO LEE los cambios de precio o costo y deja una fila de historial. No modifica ni
-- borra filas existentes, y no rellena historia anterior (lo anterior queda en audit_log).
--
-- Las dos tablas se escriben solo por la base (trigger y RPC de la migración siguiente): authenticated
-- solo lee, y solo encargado, dueño y programador (incluyen costos).
--
-- Precisión sobre el contrato (v0.9.x §19.3): price_bulk_changes agrega dos columnas nulables,
-- revert_idempotency_key y revert_result, para que revert_price_change sea idempotente como el resto
-- de las RPC (§8.5): un reintento con la misma clave devuelve el mismo resultado.

-- ---------------------------------------------------------------------------
-- 1. price_bulk_changes (cada aumento masivo)
-- ---------------------------------------------------------------------------
create table public.price_bulk_changes (
  id uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  percent numeric(7, 3) not null,
  rounding_multiple numeric(12, 2),
  brand_ids uuid[],
  supplier_ids uuid[],
  category_ids uuid[],
  product_ids uuid[],
  excluded_product_ids uuid[] not null default '{}',
  products_count integer not null,
  status text not null default 'applied',
  reverted_at timestamptz,
  reverted_by uuid,
  revert_reason text,
  revert_idempotency_key uuid,
  revert_result jsonb,
  notes text,
  constraint price_bulk_changes_pkey primary key (id),
  constraint price_bulk_changes_idempotency_key_key unique (idempotency_key),
  constraint price_bulk_changes_revert_idempotency_key_key unique (revert_idempotency_key),
  -- Tope de seguridad de P-51: 50 % en valor absoluto, fijo en la base.
  constraint price_bulk_changes_percent_check check (percent <> 0 and abs(percent) <= 50),
  constraint price_bulk_changes_rounding_multiple_check check (rounding_multiple is null or rounding_multiple > 0),
  constraint price_bulk_changes_products_count_check check (products_count >= 0),
  constraint price_bulk_changes_status_check check (status in ('applied', 'reverted')),
  constraint price_bulk_changes_revert_fields_check check (
    (status = 'applied'
      and reverted_at is null and reverted_by is null and revert_reason is null
      and revert_idempotency_key is null and revert_result is null)
    or
    (status = 'reverted'
      and reverted_at is not null and reverted_by is not null and coalesce(length(trim(revert_reason)), 0) > 0
      and revert_idempotency_key is not null and revert_result is not null)
  ),
  constraint price_bulk_changes_created_by_fkey foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint price_bulk_changes_reverted_by_fkey foreign key (reverted_by) references public.profiles (id) on delete restrict
);

comment on table public.price_bulk_changes is
  'Cada aumento masivo de precios (contrato §19.3): filtros, porcentaje, redondeo y estado. Inmutable salvo applied -> reverted.';

create index price_bulk_changes_created_at_idx on public.price_bulk_changes (created_at desc);

create function private.price_bulk_changes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'APPEND_ONLY: price_bulk_changes no admite DELETE' using errcode = '42501';
  end if;
  -- Única edición: applied -> reverted, sin tocar nada más que los datos de la reversión.
  if old.status = 'applied' and new.status = 'reverted'
     and (to_jsonb(new) - 'status' - 'reverted_at' - 'reverted_by' - 'revert_reason' - 'revert_idempotency_key' - 'revert_result')
         = (to_jsonb(old) - 'status' - 'reverted_at' - 'reverted_by' - 'revert_reason' - 'revert_idempotency_key' - 'revert_result') then
    return new;
  end if;
  raise exception 'APPEND_ONLY: un aumento masivo solo admite el paso de applied a reverted' using errcode = '42501';
end;
$$;

revoke all on function private.price_bulk_changes_guard() from public;

create trigger price_bulk_changes_guard
  before update or delete on public.price_bulk_changes
  for each row execute function private.price_bulk_changes_guard();
create trigger price_bulk_changes_no_truncate
  before truncate on public.price_bulk_changes
  for each statement execute function private.reject_modification();

-- ---------------------------------------------------------------------------
-- 2. price_history (solo-agregado)
-- ---------------------------------------------------------------------------
create table public.price_history (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  old_sale_price numeric(12, 4) not null,
  new_sale_price numeric(12, 4) not null,
  old_cost_price numeric(12, 2) not null,
  new_cost_price numeric(12, 2) not null,
  source text not null,
  bulk_change_id uuid,
  reason text,
  constraint price_history_pkey primary key (id),
  constraint price_history_source_check check (source in ('manual', 'bulk_increase', 'bulk_revert')),
  -- bulk_change_id solo para los cambios masivos.
  constraint price_history_bulk_change_check check ((source = 'manual') = (bulk_change_id is null)),
  constraint price_history_product_id_fkey foreign key (product_id) references public.products (id) on delete restrict,
  constraint price_history_changed_by_fkey foreign key (changed_by) references public.profiles (id) on delete restrict,
  constraint price_history_bulk_change_id_fkey foreign key (bulk_change_id)
    references public.price_bulk_changes (id) on delete restrict
);

comment on table public.price_history is
  'Historial de precios y costos de cada producto (contrato §19.2). Solo-agregado: lo escribe un trigger de products.';

create index price_history_product_changed_at_idx on public.price_history (product_id, changed_at desc);
create index price_history_bulk_change_id_idx on public.price_history (bulk_change_id) where bulk_change_id is not null;

create trigger price_history_append_only
  before update or delete on public.price_history
  for each row execute function private.reject_modification();
create trigger price_history_no_truncate
  before truncate on public.price_history
  for each statement execute function private.reject_modification();

-- ---------------------------------------------------------------------------
-- 3. Trigger sobre products: una fila por cada cambio de precio o de costo
-- ---------------------------------------------------------------------------
-- Cualquier camino que cambie sale_price o cost_price deja fila (también la edición manual).
-- Las RPC de aumentos masivos avisan el origen con set_config(..., true), válido solo dentro de la
-- transacción. El trigger VALIDA lo que recibe: si el origen es bulk_*, el bulk_change_id tiene que
-- existir en price_bulk_changes (y bulk_revert solo sobre uno todavía aplicado); si no, la fila queda
-- como manual y sin bulk_change_id. Así una edición manual nunca se etiqueta como parte de un aumento.
create function private.log_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := coalesce(nullif(current_setting('app.price_change_source', true), ''), 'manual');
  v_bulk uuid;
  v_reason text;
begin
  begin
    v_bulk := nullif(current_setting('app.price_bulk_change_id', true), '')::uuid;
  exception when others then
    v_bulk := null;
  end;

  if v_source in ('bulk_increase', 'bulk_revert')
     and v_bulk is not null
     and exists (
       select 1 from public.price_bulk_changes b
       where b.id = v_bulk and (v_source = 'bulk_increase' or b.status = 'applied')
     ) then
    v_reason := nullif(trim(current_setting('app.price_change_reason', true)), '');
  else
    v_source := 'manual';
    v_bulk := null;
    v_reason := null;
  end if;

  insert into public.price_history (
    product_id, changed_by, old_sale_price, new_sale_price, old_cost_price, new_cost_price,
    source, bulk_change_id, reason
  )
  values (
    new.id, (select auth.uid()), old.sale_price, new.sale_price, old.cost_price, new.cost_price,
    v_source, v_bulk, v_reason
  );
  return null;
end;
$$;

revoke all on function private.log_price_change() from public;

create trigger products_log_price_change
  after update of sale_price, cost_price on public.products
  for each row
  when (old.sale_price is distinct from new.sale_price or old.cost_price is distinct from new.cost_price)
  execute function private.log_price_change();

-- ---------------------------------------------------------------------------
-- 4. RLS y permisos: solo lectura para encargado, dueño y programador
-- ---------------------------------------------------------------------------
alter table public.price_bulk_changes enable row level security;
alter table public.price_history enable row level security;

revoke all on table public.price_bulk_changes, public.price_history from public, anon, authenticated;
grant select on table public.price_bulk_changes, public.price_history to authenticated;

create policy price_bulk_changes_select on public.price_bulk_changes
  for select to authenticated using ((select private.is_manager_or_admin()));
create policy price_history_select on public.price_history
  for select to authenticated using ((select private.is_manager_or_admin()));
