import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpiryStatus } from '../../domain/expiry'
import type { SaleUnit } from '../../domain/units'
import { pageRange } from '../../lib/pagination'
import { NO_SUPPLIER, sanitizeSearch, type ExpiryFilter, type ProductListParams } from './list-params'

/** Fila de la vista `v_product_list` (contrato v0.4.0 §7.2 y §7.3). */
export interface ProductListRow {
  id: string
  sku: string
  barcode: string | null
  name: string
  category_id: string
  category_name: string
  brand_id: string
  brand_name: string
  supplier_id: string | null
  supplier_name: string | null
  sale_unit: SaleUnit
  /** Sin IVA (v0.4.0). */
  cost_price: number
  /** Sin IVA (v0.4.0). */
  sale_price: number
  /** Precio de góndola, calculado por la base (v0.4.0). */
  sale_price_with_vat: number
  vat_rate: number
  boxes_quantity: number
  units_per_box: number
  min_stock: number
  is_active: boolean
  stock_quantity: number
  next_expires_on: string | null
  next_expiry_status: ExpiryStatus | null
  active_batches_count: number
  is_low_stock: boolean
  /** Unidades dentro de cajas cerradas (`boxes_quantity * units_per_box`). */
  units_in_boxes: number
  /** Unidades sueltas (`stock_quantity - units_in_boxes`). */
  loose_units: number
  /** Las cajas contadas superan el stock: hay que revisar el conteo. */
  has_box_mismatch: boolean
  /** Código propio del sistema anterior (v0.5.0, P-25). */
  legacy_code: string | null
}

export interface ProductListPage {
  rows: ProductListRow[]
  total: number
}

const COLUMNS =
  'id, sku, barcode, name, category_id, category_name, brand_id, brand_name, supplier_id, supplier_name, ' +
  'sale_unit, cost_price, sale_price, sale_price_with_vat, vat_rate, boxes_quantity, units_per_box, min_stock, ' +
  'is_active, stock_quantity, next_expires_on, next_expiry_status, active_batches_count, is_low_stock, ' +
  'units_in_boxes, loose_units, has_box_mismatch, legacy_code'

const EXPIRY_STATUSES_BY_FILTER: Record<ExpiryFilter, ExpiryStatus[]> = {
  por_vencer: ['expires_urgent', 'expires_soon', 'expires_upcoming'],
  urgente: ['expires_urgent'],
  vencido: ['expired'],
}

/** Subconjunto del query builder de supabase-js que usa el listado (facilita las pruebas). */
export interface ListQuery {
  or(filters: string): ListQuery
  eq(column: string, value: unknown): ListQuery
  is(column: string, value: null): ListQuery
  in(column: string, values: readonly unknown[]): ListQuery
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): ListQuery
  range(from: number, to: number): PromiseLike<{ data: unknown; error: unknown; count: number | null }>
}

/** Aplica búsqueda, filtros, orden y paginación. Todo se resuelve en la base. */
export function applyListParams(query: ListQuery, p: ProductListParams) {
  let q = query
  const term = sanitizeSearch(p.search)
  if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%,legacy_code.ilike.%${term}%`)
  if (p.categoryId) q = q.eq('category_id', p.categoryId)
  if (p.supplierId === NO_SUPPLIER) q = q.is('supplier_id', null)
  else if (p.supplierId) q = q.eq('supplier_id', p.supplierId)
  if (p.lowStock) q = q.eq('is_low_stock', true)
  if (p.expiry) q = q.in('next_expiry_status', EXPIRY_STATUSES_BY_FILTER[p.expiry])
  if (p.status === 'activos') q = q.eq('is_active', true)
  else if (p.status === 'inactivos') q = q.eq('is_active', false)

  // Orden pedido + desempates fijos para que la paginación sea estable.
  q = q.order(p.sort, { ascending: p.direction === 'asc', nullsFirst: false })
  if (p.sort !== 'name') q = q.order('name', { ascending: true })
  q = q.order('id', { ascending: true })

  const [from, to] = pageRange(p.page, p.pageSize)
  return q.range(from, to)
}

export async function fetchProductList(client: SupabaseClient, p: ProductListParams): Promise<ProductListPage> {
  const base = client.from('v_product_list').select(COLUMNS, { count: 'exact' }) as unknown as ListQuery
  const { data, error, count } = await applyListParams(base, p)
  if (error) throw error
  return { rows: (data ?? []) as ProductListRow[], total: count ?? 0 }
}

/** Un producto con su stock (ficha del producto). */
export async function fetchProductSummary(client: SupabaseClient, id: string): Promise<ProductListRow> {
  const { data, error } = await client.from('v_product_list').select(COLUMNS).eq('id', id).single()
  if (error) throw error
  return data as unknown as ProductListRow
}

/* ------------------------------------------------------------------ */
/* Clasificación en lote (encargado y dueño)                           */
/* ------------------------------------------------------------------ */

const ID_PAGE = 1000

/** Todos los ids que coinciden con el filtro actual (sin paginar), con el mismo filtro del listado. */
export async function fetchMatchingIds(client: SupabaseClient, p: ProductListParams): Promise<string[]> {
  const ids: string[] = []
  for (let page = 1; ; page++) {
    const base = client.from('v_product_list').select('id', { count: 'exact' }) as unknown as ListQuery
    const { data, error } = await applyListParams(base, { ...p, page, pageSize: ID_PAGE })
    if (error) throw error
    const rows = (data ?? []) as { id: string }[]
    rows.forEach((r) => ids.push(r.id))
    if (rows.length < ID_PAGE) return ids
  }
}

export interface ClassificationChange {
  category_id?: string
  brand_id?: string
}

const UPDATE_CHUNK = 200

/**
 * Cambia categoría y/o marca de muchos productos, de a tandas. Es un UPDATE
 * con RLS (solo encargado y dueño) y cada fila queda en audit_log. Si la base
 * actualiza menos filas que las pedidas, es falta de permiso.
 */
export async function bulkClassify(
  client: SupabaseClient,
  ids: string[],
  change: ClassificationChange,
  onProgress?: (done: number) => void,
): Promise<number> {
  let done = 0
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK)
    const { data, error } = await client.from('products').update(change).in('id', chunk).select('id')
    if (error) throw error
    if (((data ?? []) as unknown[]).length < chunk.length) throw { code: '42501', message: 'UPDATE_NO_ROWS' }
    done += chunk.length
    onProgress?.(done)
  }
  return done
}
