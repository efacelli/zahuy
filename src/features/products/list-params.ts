/**
 * Estado del listado de productos guardado en la URL, para poder recargar,
 * volver atrás o compartir un filtro (por ejemplo, "stock bajo de Lácteos").
 */

import { DEFAULT_PAGE_SIZE } from '../../lib/pagination'

export const PRODUCT_SORT_KEYS = [
  'sku',
  'name',
  'brand_name',
  'category_name',
  'supplier_name',
  'cost_price',
  'sale_price',
  'stock_quantity',
  'boxes_quantity',
  'next_expires_on',
] as const
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number]

/** Filtro de vencimiento: por vencer (30 días o menos), urgente (7 o menos) o vencido. */
export const EXPIRY_FILTERS = ['por_vencer', 'urgente', 'vencido'] as const
export type ExpiryFilter = (typeof EXPIRY_FILTERS)[number]

export const STATUS_FILTERS = ['activos', 'inactivos', 'todos'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

/** Valor especial del filtro de proveedor para productos sin proveedor. */
export const NO_SUPPLIER = 'ninguno'

export interface ProductListParams {
  search: string
  categoryId: string | null
  /** uuid, `NO_SUPPLIER` o null (todos). */
  supplierId: string | null
  lowStock: boolean
  expiry: ExpiryFilter | null
  status: StatusFilter
  sort: ProductSortKey
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const DEFAULT_LIST_PARAMS: ProductListParams = {
  search: '',
  categoryId: null,
  supplierId: null,
  lowStock: false,
  expiry: null,
  status: 'activos',
  sort: 'name',
  direction: 'asc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null
}

/** Lee los parámetros de la URL; cualquier valor inválido vuelve al valor por defecto. */
export function parseListParams(search: URLSearchParams): ProductListParams {
  const page = Number(search.get('pagina'))
  const supplier = search.get('proveedor')
  const category = search.get('categoria')
  return {
    search: (search.get('q') ?? '').slice(0, 100),
    categoryId: category && UUID.test(category) ? category : null,
    supplierId: supplier === NO_SUPPLIER || (supplier && UUID.test(supplier)) ? supplier : null,
    lowStock: search.get('stock') === 'bajo',
    expiry: oneOf(EXPIRY_FILTERS, search.get('vence')),
    status: oneOf(STATUS_FILTERS, search.get('estado')) ?? DEFAULT_LIST_PARAMS.status,
    sort: oneOf(PRODUCT_SORT_KEYS, search.get('orden')) ?? DEFAULT_LIST_PARAMS.sort,
    direction: search.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: DEFAULT_LIST_PARAMS.pageSize,
  }
}

/** Arma la URL; omite los valores por defecto para que quede corta. */
export function serializeListParams(p: ProductListParams): URLSearchParams {
  const out = new URLSearchParams()
  if (p.search.trim()) out.set('q', p.search.trim())
  if (p.categoryId) out.set('categoria', p.categoryId)
  if (p.supplierId) out.set('proveedor', p.supplierId)
  if (p.lowStock) out.set('stock', 'bajo')
  if (p.expiry) out.set('vence', p.expiry)
  if (p.status !== DEFAULT_LIST_PARAMS.status) out.set('estado', p.status)
  if (p.sort !== DEFAULT_LIST_PARAMS.sort) out.set('orden', p.sort)
  if (p.direction !== 'asc') out.set('dir', p.direction)
  if (p.page > 1) out.set('pagina', String(p.page))
  return out
}

export function hasActiveFilters(p: ProductListParams): boolean {
  return Boolean(
    p.search.trim() || p.categoryId || p.supplierId || p.lowStock || p.expiry || p.status !== DEFAULT_LIST_PARAMS.status,
  )
}

/**
 * Texto de búsqueda seguro para el filtro `or(...)` de PostgREST:
 * se quitan los caracteres que tienen significado en esa sintaxis o en LIKE.
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()*%_\\"'.:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}
