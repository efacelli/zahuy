-- v0.4 paso C: nombres de catálogos únicos también sin distinguir tildes.
-- Contrato: docs/DATA_CONTRACT.md v0.4.x, secciones 5.2, 5.3, 5.4 y 8.8.
--
-- "lacteos" y "Lácteos" pasan a ser el mismo nombre para categories, brands y
-- suppliers. Los índices únicos conservan su nombre (el frontend traduce el
-- error 23505 por ese nombre).
--
-- NO modifica datos. Si ya existen nombres que chocan con la regla nueva, la
-- migración FALLA con la lista de nombres y no cambia nada: hay que
-- renombrarlos o unificarlos a mano y volver a aplicarla.

create extension if not exists unaccent with schema extensions;

-- unaccent() es STABLE (depende del diccionario configurado), así que no se
-- puede usar directamente en un índice. Esta envoltura fija el diccionario y
-- el search_path, y por eso puede declararse IMMUTABLE.
create function private.unaccent_text(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text);
$$;

comment on function private.unaccent_text(text) is
  'Quita tildes y diacríticos. IMMUTABLE para poder usarla en índices únicos.';

revoke all on function private.unaccent_text(text) from public;
-- La usa el índice en cada INSERT/UPDATE de catálogos, con el rol de quien escribe.
grant execute on function private.unaccent_text(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Chequeo previo: duplicados existentes bajo la regla nueva
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_duplicates text;
  v_report text := '';
begin
  foreach v_table in array array['categories', 'brands', 'suppliers'] loop
    execute format(
      $q$
        select string_agg(names, '; ' order by names)
        from (
          select string_agg(quote_literal(name), ' = ' order by name) as names
          from public.%I
          group by lower(private.unaccent_text(trim(name)))
          having count(*) > 1
        ) d
      $q$,
      v_table
    ) into v_duplicates;

    if v_duplicates is not null then
      v_report := v_report || format(E'\n  %s: %s', v_table, v_duplicates);
    end if;
  end loop;

  if v_report <> '' then
    raise exception 'DUPLICATE_CATALOG_NAMES: hay nombres que solo difieren en tildes o mayúsculas:%', v_report
      using hint = 'Renombrá o unificá esos registros a mano y volvé a aplicar la migración. No se modificó ningún dato.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recrear los índices con el mismo nombre
-- ---------------------------------------------------------------------------
-- Se crea el índice nuevo, se quita el viejo y se renombra: la unicidad nunca
-- queda sin cubrir.
create unique index categories_name_key_unaccent
  on public.categories (lower(private.unaccent_text(trim(name))));
drop index public.categories_name_key;
alter index public.categories_name_key_unaccent rename to categories_name_key;

create unique index brands_name_key_unaccent
  on public.brands (lower(private.unaccent_text(trim(name))));
drop index public.brands_name_key;
alter index public.brands_name_key_unaccent rename to brands_name_key;

create unique index suppliers_name_key_unaccent
  on public.suppliers (lower(private.unaccent_text(trim(name))));
drop index public.suppliers_name_key;
alter index public.suppliers_name_key_unaccent rename to suppliers_name_key;
