import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpiryStatus } from '../../domain/expiry'
import type { SaleUnit } from '../../domain/units'
import { pageRange } from '../../lib/pagination'
import { NO_SUPPLIER, sanitizeSearch, type ExpiryFilter, type ProductListParams } from './list-params'

/** Fila de la vista `v_product_list` (contrato §7.3). */
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
  cost_price: number
  sale_price: number
  vat_rate: number
  boxes_quantity: number
  min_stock: number
  is_active: boolean
  stock_quantity: number
  next_expires_on: string | null
  next_expiry_status: ExpiryStatus | null
  active_batches_count: number
  is_low_stock: boolean
}

export interface ProductListPage {
  rows: ProductListRow[]
  total: number
}

const COLUMNS =
  'id, sku, barcode, name, category_id, category_name, brand_id, brand_name, supplier_id, supplier_name, ' +
  'sale_unit, cost_price, sale_price, vat_rate, boxes_quantity, min_stock, is_active, stock_quantity, ' +
  'next_expires_on, next_expiry_status, active_batches_count, is_low_stock'

const EXPIRY_STATUSES_BY_FILTER: Record<ExpiryFilter, ExpiryStatus[]> = {
  por_vencer: ['expires_7', 'expires_15', 'expires_30'],
  urgente: ['expires_7'],
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
  if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
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
