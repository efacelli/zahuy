import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogKind, CatalogRow } from './catalog-config'

const COLUMNS: Record<CatalogKind, string> = {
  categories: 'id, name, is_active',
  brands: 'id, name, is_active',
  suppliers: 'id, name, is_active, tax_id, phone, email, notes',
}

/** Todos los registros (activos e inactivos); los catálogos son chicos. */
export async function listCatalog(client: SupabaseClient, kind: CatalogKind): Promise<CatalogRow[]> {
  const { data, error } = await client.from(kind).select(COLUMNS[kind]).order('name')
  if (error) throw error
  return (data ?? []) as unknown as CatalogRow[]
}

export async function createCatalogItem(
  client: SupabaseClient,
  kind: CatalogKind,
  values: Record<string, unknown>,
): Promise<CatalogRow> {
  const { data, error } = await client.from(kind).insert(values).select(COLUMNS[kind]).single()
  if (error) throw error
  return data as unknown as CatalogRow
}

export async function updateCatalogItem(
  client: SupabaseClient,
  kind: CatalogKind,
  id: string,
  values: Record<string, unknown>,
): Promise<CatalogRow> {
  const { data, error } = await client.from(kind).update(values).eq('id', id).select(COLUMNS[kind]).single()
  if (error) throw error
  return data as unknown as CatalogRow
}
