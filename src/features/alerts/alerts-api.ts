import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpiryStatus } from '../../domain/expiry'
import type { SaleUnit } from '../../domain/units'
import { DEFAULT_PAGE_SIZE, pageRange } from '../../lib/pagination'
import { sanitizeSearch } from '../products/list-params'

/** Fila de `v_batch_status` (contrato v0.4.2 §7.1). */
export interface BatchAlertRow {
  id: string
  product_id: string
  product_sku: string
  product_name: string
  product_is_active: boolean
  sale_unit: SaleUnit
  category_id: string
  category_name: string
  batch_number: string | null
  received_on: string
  expires_on: string
  quantity_available: number
  days_to_expiry: number
  expiry_status: ExpiryStatus
}

/** Niveles que muestra la pantalla; nunca agotados, sin vencimiento ni vigentes. */
export const ALERT_FILTERS = ['todas', 'vencidos', 'urgentes', 'proximos'] as const
export type AlertFilter = (typeof ALERT_FILTERS)[number]

const STATUSES_BY_FILTER: Record<AlertFilter, ExpiryStatus[]> = {
  todas: ['expired', 'expires_urgent', 'expires_soon', 'expires_upcoming'],
  vencidos: ['expired'],
  urgentes: ['expires_urgent'],
  proximos: ['expires_soon', 'expires_upcoming'],
}

export interface AlertParams {
  level: AlertFilter
  categoryId: string | null
  search: string
  page: number
}

export const DEFAULT_ALERT_PARAMS: AlertParams = { level: 'todas', categoryId: null, search: '', page: 1 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseAlertParams(search: URLSearchParams): AlertParams {
  const level = search.get('nivel')
  const category = search.get('categoria')
  const page = Number(search.get('pagina'))
  return {
    level: (ALERT_FILTERS as readonly string[]).includes(level ?? '') ? (level as AlertFilter) : 'todas',
    categoryId: category && UUID.test(category) ? category : null,
    search: (search.get('q') ?? '').slice(0, 100),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

export function serializeAlertParams(p: AlertParams): URLSearchParams {
  const out = new URLSearchParams()
  if (p.level !== 'todas') out.set('nivel', p.level)
  if (p.categoryId) out.set('categoria', p.categoryId)
  if (p.search.trim()) out.set('q', p.search.trim())
  if (p.page > 1) out.set('pagina', String(p.page))
  return out
}

const COLUMNS =
  'id, product_id, product_sku, product_name, product_is_active, sale_unit, category_id, category_name, ' +
  'batch_number, received_on, expires_on, quantity_available, days_to_expiry, expiry_status'

/** Subconjunto del query builder que usa la pantalla (facilita las pruebas). */
export interface AlertQuery {
  in(column: string, values: readonly unknown[]): AlertQuery
  eq(column: string, value: unknown): AlertQuery
  or(filters: string): AlertQuery
  order(column: string, options: { ascending: boolean }): AlertQuery
  range(from: number, to: number): PromiseLike<{ data: unknown; error: unknown; count: number | null }>
}

export function applyAlertParams(query: AlertQuery, p: AlertParams) {
  let q = query.in('expiry_status', STATUSES_BY_FILTER[p.level])
  if (p.categoryId) q = q.eq('category_id', p.categoryId)
  const term = sanitizeSearch(p.search)
  if (term) q = q.or(`product_name.ilike.%${term}%,product_sku.ilike.%${term}%,batch_number.ilike.%${term}%`)
  q = q.order('expires_on', { ascending: true }).order('product_name', { ascending: true }).order('id', { ascending: true })
  const [from, to] = pageRange(p.page, DEFAULT_PAGE_SIZE)
  return q.range(from, to)
}

export async function fetchAlerts(client: SupabaseClient, p: AlertParams) {
  const base = client.from('v_batch_status').select(COLUMNS, { count: 'exact' }) as unknown as AlertQuery
  const { data, error, count } = await applyAlertParams(base, p)
  if (error) throw error
  return { rows: (data ?? []) as BatchAlertRow[], total: count ?? 0 }
}

/** Lotes de un producto, del que vence primero al último (ficha del producto). */
export async function fetchProductBatches(client: SupabaseClient, productId: string): Promise<BatchAlertRow[]> {
  const { data, error } = await client
    .from('v_batch_status')
    .select(COLUMNS)
    .eq('product_id', productId)
    .order('expires_on', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as BatchAlertRow[]
}
