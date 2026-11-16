import type { SupabaseClient } from '@supabase/supabase-js'
import { parseDecimalInput } from '../../lib/numbers'

/*
 * Aumentos masivos de precios (contrato v0.9.1 §19): vista previa, aplicar y
 * deshacer. La base recalcula todo al aplicar; la vista previa es solo para mirar.
 * Los costos no se tocan (P-52); tope de 50 % (P-51); sin filtros no se aplica (P-50).
 */

export interface PriceFilters {
  brandIds: string[]
  supplierIds: string[]
  categoryIds: string[]
  productIds: string[]
}

export interface PreviewRow {
  product_id: string
  sku: string
  name: string
  brand_name: string
  category_name: string
  supplier_name: string | null
  old_sale_price: number
  old_price_with_vat: number
  new_sale_price: number
  new_price_with_vat: number
  change_amount: number
}

export interface PreviewPage {
  rows: PreviewRow[]
  /** Total de productos que cumplen los filtros (la vista previa se pagina; la base corta en 1000). */
  total: number
}

export interface BulkChange {
  id: string
  created_at: string
  percent: number
  rounding_multiple: number | null
  products_count: number
  status: 'applied' | 'reverted'
  reverted_at: string | null
  revert_reason: string | null
  notes: string | null
}

export interface RevertResult {
  restored: number
  skipped_product_ids: string[]
}

export const PREVIEW_PAGE_SIZE = 100
export const MAX_PERCENT = 50
export const ROUNDING_OPTIONS = [
  { value: '10', label: 'A $10' },
  { value: '50', label: 'A $50' },
  { value: '100', label: 'A $100' },
  { value: '', label: 'Sin redondeo' },
] as const
/** P-53: la pantalla propone $10. */
export const DEFAULT_ROUNDING = '10'

export const BULK_CHANGES_KEY = ['price-bulk-changes'] as const

const nullIfEmpty = (ids: string[]) => (ids.length > 0 ? ids : null)

function filterArgs(f: PriceFilters) {
  return {
    p_brand_ids: nullIfEmpty(f.brandIds),
    p_supplier_ids: nullIfEmpty(f.supplierIds),
    p_category_ids: nullIfEmpty(f.categoryIds),
    p_product_ids: nullIfEmpty(f.productIds),
  }
}

export function hasFilters(f: PriceFilters): boolean {
  return f.brandIds.length + f.supplierIds.length + f.categoryIds.length + f.productIds.length > 0
}

/** Porcentaje escrito por el usuario: admite signo menos (baja) y coma. */
export function parsePercent(raw: string): { value: number | null; error: string | null } {
  const text = raw.trim()
  if (text === '') return { value: null, error: 'Escribí el porcentaje (por ejemplo, 8 o -5).' }
  const negative = text.startsWith('-')
  const n = parseDecimalInput(negative ? text.slice(1) : text)
  if (n === null) return { value: null, error: 'Escribí un número, por ejemplo 8 o 7,5.' }
  const value = negative ? -n : n
  if (value === 0) return { value: null, error: 'El porcentaje no puede ser 0.' }
  if (Math.abs(value) > MAX_PERCENT) return { value: null, error: `Como máximo ${MAX_PERCENT} % por vez.` }
  if (Math.round(value * 1000) / 1000 !== value) return { value: null, error: 'Como máximo 3 decimales.' }
  return { value, error: null }
}

interface RpcQuery extends PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  range(from: number, to: number): RpcQuery
}

export async function previewPriceIncrease(
  client: SupabaseClient,
  filters: PriceFilters,
  percent: number,
  rounding: number | null,
  page: number,
): Promise<PreviewPage> {
  const from = page * PREVIEW_PAGE_SIZE
  const query = client.rpc(
    'preview_price_increase',
    { ...filterArgs(filters), p_percent: percent, p_rounding_multiple: rounding },
    { count: 'exact' },
  ) as unknown as RpcQuery
  const { data, error, count } = await query.range(from, from + PREVIEW_PAGE_SIZE - 1)
  if (error) throw error
  const rows = ((data ?? []) as PreviewRow[]).map((r) => ({
    ...r,
    old_sale_price: Number(r.old_sale_price),
    old_price_with_vat: Number(r.old_price_with_vat),
    new_sale_price: Number(r.new_sale_price),
    new_price_with_vat: Number(r.new_price_with_vat),
    change_amount: Number(r.change_amount),
  }))
  return { rows, total: count ?? rows.length }
}

export async function applyPriceIncrease(
  client: SupabaseClient,
  args: {
    idempotencyKey: string
    filters: PriceFilters
    percent: number
    rounding: number | null
    excludedIds: string[]
    notes: string
  },
): Promise<BulkChange> {
  const { data, error } = await client.rpc('apply_price_increase', {
    p_idempotency_key: args.idempotencyKey,
    ...filterArgs(args.filters),
    p_percent: args.percent,
    p_rounding_multiple: args.rounding,
    p_excluded_product_ids: args.excludedIds,
    p_notes: args.notes.trim() || null,
  })
  if (error) throw error
  return normalizeChange(data as BulkChange)
}

export async function revertPriceChange(
  client: SupabaseClient,
  idempotencyKey: string,
  bulkChangeId: string,
  reason: string,
): Promise<RevertResult> {
  const { data, error } = await client.rpc('revert_price_change', {
    p_idempotency_key: idempotencyKey,
    p_bulk_change_id: bulkChangeId,
    p_reason: reason.trim(),
  })
  if (error) throw error
  const r = (data ?? {}) as Partial<RevertResult>
  return { restored: Number(r.restored ?? 0), skipped_product_ids: r.skipped_product_ids ?? [] }
}

function normalizeChange(r: BulkChange): BulkChange {
  return {
    ...r,
    percent: Number(r.percent),
    rounding_multiple: r.rounding_multiple === null ? null : Number(r.rounding_multiple),
    products_count: Number(r.products_count),
  }
}

export async function listBulkChanges(client: SupabaseClient): Promise<BulkChange[]> {
  const { data, error } = await client
    .from('price_bulk_changes')
    .select('id, created_at, percent, rounding_multiple, products_count, status, reverted_at, revert_reason, notes')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return ((data ?? []) as BulkChange[]).map(normalizeChange)
}

/** La base todavía no tiene las funciones de §19 (antes de la migración). */
export function isNotEnabled(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01'
}
