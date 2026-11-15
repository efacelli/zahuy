import type { SupabaseClient } from '@supabase/supabase-js'
import { toAppError } from '../../lib/errors'
import { idempotencyKeyFor, type LegacyItem } from './legacy-csv'

/** P-26: la exportación no trae categoría ni marca; se ordenan después. */
export const UNCLASSIFIED = 'Sin clasificar'

async function findOrCreate(client: SupabaseClient, table: 'categories' | 'brands'): Promise<string> {
  const { data, error } = await client.from(table).select('id').ilike('name', UNCLASSIFIED).limit(1)
  if (error) throw error
  const found = (data as { id: string }[] | null)?.[0]
  if (found) return found.id
  const created = await client.from(table).insert({ name: UNCLASSIFIED }).select('id').single()
  if (created.error) throw created.error
  return (created.data as { id: string }).id
}

export async function ensureUnclassified(client: SupabaseClient): Promise<{ categoryId: string; brandId: string }> {
  const [categoryId, brandId] = await Promise.all([findOrCreate(client, 'categories'), findOrCreate(client, 'brands')])
  return { categoryId, brandId }
}

/** Códigos anteriores que ya están en la base (en mayúsculas, como el índice único). */
export async function fetchExistingLegacyCodes(client: SupabaseClient): Promise<Set<string>> {
  const codes = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('products')
      .select('legacy_code')
      .not('legacy_code', 'is', null)
      .order('legacy_code')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as { legacy_code: string }[]
    rows.forEach((r) => codes.add(r.legacy_code.toUpperCase()))
    if (rows.length < PAGE) return codes
  }
}

export interface ImportFailure {
  item: LegacyItem
  message: string
}

export interface ImportProgress {
  done: number
  created: number
  failures: ImportFailure[]
}

/** Alta de un producto del sistema anterior (contrato §8.4, sin stock: el stock se carga con vencimiento). */
export async function importItem(
  client: SupabaseClient,
  item: LegacyItem,
  ids: { categoryId: string; brandId: string },
): Promise<void> {
  const { error } = await client
    .rpc('create_product', {
      p_idempotency_key: await idempotencyKeyFor(item.legacyCode),
      p_name: item.name,
      p_category_id: ids.categoryId,
      p_brand_id: ids.brandId,
      p_sale_unit: 'unit',
      p_cost_price: item.costPrice,
      p_sale_price: item.salePrice,
      p_vat_rate: item.vatRate,
      p_legacy_code: item.legacyCode,
    })
    .single()
  if (error) throw error
}

/**
 * Importa de a `concurrency` productos a la vez. Un error en un producto no
 * corta el resto; un corte de red o de sesión sí (no tiene sentido seguir).
 * Se puede repetir: la clave por código hace que no se duplique nada.
 */
export async function runImport(
  client: SupabaseClient,
  items: LegacyItem[],
  ids: { categoryId: string; brandId: string },
  onProgress: (p: ImportProgress) => void,
  shouldStop: () => boolean,
  concurrency = 4,
): Promise<ImportProgress & { stoppedBy: string | null }> {
  const progress: ImportProgress = { done: 0, created: 0, failures: [] }
  let next = 0
  let stoppedBy: string | null = null

  async function worker() {
    while (!stoppedBy && !shouldStop() && next < items.length) {
      const item = items[next++] as LegacyItem
      try {
        await importItem(client, item, ids)
        progress.created++
      } catch (e) {
        const appError = toAppError(e)
        if (appError.kind === 'network' || appError.kind === 'auth') stoppedBy = appError.message
        else progress.failures.push({ item, message: appError.message })
      }
      progress.done++
      onProgress({ ...progress, failures: [...progress.failures] })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return { ...progress, stoppedBy }
}
