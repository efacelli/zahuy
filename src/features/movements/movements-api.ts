import type { SupabaseClient } from '@supabase/supabase-js'
import type { MovementType } from '../../domain/movements'
import type { SaleUnit } from '../../domain/units'
import { DEFAULT_PAGE_SIZE, pageRange } from '../../lib/pagination'
import { textSearchFilter } from '../products/list-params'

/* ------------------------------------------------------------------ */
/* Productos para elegir en los formularios                            */
/* ------------------------------------------------------------------ */

export interface ProductOption {
  id: string
  sku: string
  name: string
  sale_unit: SaleUnit
  /** Contrato v0.4.0 §5.5. */
  units_per_box: number
  is_active: boolean
  /** Contrato §5.5; null si todavía no tiene código cargado. */
  barcode: string | null
}

const PRODUCT_OPTION_COLUMNS = 'id, sku, name, sale_unit, units_per_box, is_active, barcode'

/**
 * Busca productos por nombre, SKU o código de barras (máximo 20). Por defecto
 * solo activos; `includeInactive` los suma para dar de baja stock de productos
 * discontinuados (P-13).
 */
export async function searchProducts(
  client: SupabaseClient,
  text: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<ProductOption[]> {
  const search = textSearchFilter(text)
  let q = client.from('products').select(PRODUCT_OPTION_COLUMNS)
  if (!includeInactive) q = q.eq('is_active', true)
  if (search) q = q.or(search)
  const { data, error } = await q.order('name').limit(20)
  if (error) throw error
  return (data ?? []) as ProductOption[]
}

/** Producto con ese código de barras exacto (lector USB), o null. */
export async function findProductByBarcode(
  client: SupabaseClient,
  code: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<ProductOption | null> {
  let q = client.from('products').select(PRODUCT_OPTION_COLUMNS).eq('barcode', code)
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q.limit(1)
  if (error) throw error
  return ((data ?? []) as ProductOption[])[0] ?? null
}

/* ------------------------------------------------------------------ */
/* Escritura: RPC del contrato (§8.1, §8.3, §8.7)                       */
/* ------------------------------------------------------------------ */

export interface ReceiveStockParams {
  p_idempotency_key: string
  p_product_id: string
  p_quantity: number
  p_received_on: string | null
  p_expires_on: string
  p_batch_number: string | null
  p_notes: string | null
}

export interface MovementRow {
  id: string
  batch_id: string
  product_id: string
  movement_type: MovementType
  quantity: number
  batch_quantity_after: number
}

/** Ingreso de mercadería con lote nuevo (§8.1). */
export async function receiveStock(client: SupabaseClient, params: ReceiveStockParams): Promise<MovementRow> {
  const { data, error } = await client.rpc('receive_stock', params).single()
  if (error) throw error
  return data as MovementRow
}

export interface ProductMovementParams {
  p_idempotency_key: string
  p_product_id: string
  p_movement_type: MovementType
  p_quantity: number
  p_reason: string | null
  p_notes: string | null
  p_occurred_at: string | null
}

/**
 * Salida o ajuste por producto; la base elige los lotes por vencimiento (§8.7)
 * y devuelve un movimiento por lote usado.
 */
export async function registerProductMovement(
  client: SupabaseClient,
  params: ProductMovementParams,
): Promise<MovementRow[]> {
  const { data, error } = await client.rpc('register_product_movement', params)
  if (error) throw error
  return (data ?? []) as MovementRow[]
}

export interface ReverseParams {
  p_idempotency_key: string
  p_movement_id: string
  p_reason: string
}

/** Movimiento compensatorio de uno mal cargado (§8.3). */
export async function reverseMovement(client: SupabaseClient, params: ReverseParams): Promise<MovementRow> {
  const { data, error } = await client.rpc('reverse_stock_movement', params).single()
  if (error) throw error
  return data as MovementRow
}

/* ------------------------------------------------------------------ */
/* Historial: tabla stock_movements con RLS de lectura (§5.7, §9)      */
/* ------------------------------------------------------------------ */

export interface MovementHistoryRow {
  id: string
  movement_type: MovementType
  quantity: number
  signed_quantity: number
  batch_quantity_after: number
  reason: string | null
  notes: string | null
  occurred_at: string
  reverses_movement_id: string | null
  /** La comparten los movimientos de una misma salida repartida en lotes (§8.7). */
  operation_key?: string | null
  batch: {
    batch_number: string | null
    expires_on: string | null
    product: { sku: string; name: string; sale_unit: SaleUnit } | null
  } | null
  author: { full_name: string } | null
  /** Calculado en el cliente: ya existe un movimiento que lo anula. */
  is_reversed?: boolean
}

/*
 * stock_movements no tiene FK directa a products: el producto se llega por el
 * lote (FK compuesta stock_movements_batch_product_fkey). El autor, por
 * stock_movements_created_by_fkey.
 */
const HISTORY_COLUMNS =
  'id, movement_type, quantity, signed_quantity, batch_quantity_after, reason, notes, occurred_at, reverses_movement_id, ' +
  'operation_key, ' +
  'batch:product_batches!stock_movements_batch_product_fkey(batch_number, expires_on, product:products(sku, name, sale_unit)), ' +
  'author:profiles!stock_movements_created_by_fkey(full_name)'

export interface HistoryParams {
  type: MovementType | null
  page: number
  /** Solo los movimientos de un producto (ficha del producto). */
  productId?: string
}

/** Subconjunto del query builder que usa el historial (facilita las pruebas). */
export interface HistoryQuery {
  eq(column: string, value: unknown): HistoryQuery
  order(column: string, options: { ascending: boolean }): HistoryQuery
  range(from: number, to: number): PromiseLike<{ data: unknown; error: unknown; count: number | null }>
}

export function applyHistoryParams(query: HistoryQuery, p: HistoryParams) {
  let q = query
  if (p.productId) q = q.eq('product_id', p.productId)
  if (p.type) q = q.eq('movement_type', p.type)
  q = q.order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true })
  const [from, to] = pageRange(p.page, DEFAULT_PAGE_SIZE)
  return q.range(from, to)
}

export async function fetchMovementHistory(client: SupabaseClient, p: HistoryParams) {
  const base = client.from('stock_movements').select(HISTORY_COLUMNS, { count: 'exact' }) as unknown as HistoryQuery
  const { data, error, count } = await applyHistoryParams(base, p)
  if (error) throw error
  const rows = (data ?? []) as MovementHistoryRow[]
  const reversed = await fetchReversedIds(client, rows.map((r) => r.id))
  return { rows: rows.map((r) => ({ ...r, is_reversed: reversed.has(r.id) })), total: count ?? 0 }
}

/** Cuántos movimientos generó la misma operación (una salida FEFO puede tocar varios lotes). */
export async function countOperationParts(client: SupabaseClient, operationKey: string): Promise<number> {
  const { count, error } = await client
    .from('stock_movements')
    .select('id', { count: 'exact', head: true })
    .eq('operation_key', operationKey)
  if (error) throw error
  return count ?? 0
}

/**
 * De estos movimientos, cuáles ya tienen anulación. PostgREST no expone la
 * relación inversa de reverses_movement_id (FK de la tabla consigo misma), así
 * que se consulta aparte; la base igual rechaza anular dos veces (ALREADY_REVERSED).
 */
async function fetchReversedIds(client: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await client.from('stock_movements').select('reverses_movement_id').in('reverses_movement_id', ids)
  if (error) throw error
  return new Set(((data ?? []) as { reverses_movement_id: string | null }[]).flatMap((r) => r.reverses_movement_id ?? []))
}
