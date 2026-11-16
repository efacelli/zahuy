import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaleUnit } from '../../domain/units'
import { lastDays, localDay } from './finance-api'

/*
 * Más vendidos, menos vendidos y sin ventas en el período, con
 * `product_sales_ranking(p_from, p_to)` (contrato v0.8.0 §17). El filtro, el
 * orden y el límite los resuelve la base: el navegador nunca trae todos los
 * productos.
 */

export interface RankingRow {
  product_id: string
  sku: string
  name: string
  brand_name: string
  sale_unit: SaleUnit
  quantity_sold: number
  sales_count: number
  revenue_total: number
  gross_margin: number
  last_sold_at: string | null
  stock_quantity: number
  product_created_at: string
}

/** P-46: por importe (por defecto, porque mezcla kg y unidades) o por cantidad. */
export type RankingMetric = 'revenue_total' | 'quantity_sold'

export interface RankingData {
  top: RankingRow[]
  bottom: RankingRow[]
  idle: RankingRow[]
  /** Cuántos productos con stock no se vendieron en el período (puede ser más que los listados). */
  idleCount: number
}

export const RANKING_SIZE = 10
export const IDLE_SIZE = 20

const COLUMNS =
  'product_id, sku, name, brand_name, sale_unit, quantity_sold, sales_count, revenue_total, gross_margin, last_sold_at, stock_quantity, product_created_at'

function normalize(r: RankingRow): RankingRow {
  return {
    ...r,
    quantity_sold: Number(r.quantity_sold),
    sales_count: Number(r.sales_count),
    revenue_total: Number(r.revenue_total),
    gross_margin: Number(r.gross_margin),
    stock_quantity: Number(r.stock_quantity),
  }
}

/** Período de los últimos `range` días locales, ambos extremos incluidos. */
export function rankingPeriod(range: number, today = new Date()): { p_from: string; p_to: string } {
  return { p_from: lastDays(range, today)[0]!, p_to: localDay(today) }
}

/** Subconjunto del builder de PostgREST que usa el ranking (facilita las pruebas). */
interface RankingQuery extends PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  select(columns: string): RankingQuery
  eq(column: string, value: unknown): RankingQuery
  gt(column: string, value: unknown): RankingQuery
  lt(column: string, value: unknown): RankingQuery
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): RankingQuery
  limit(n: number): RankingQuery
}

export async function fetchRanking(
  client: SupabaseClient,
  range: number,
  metric: RankingMetric,
  today = new Date(),
): Promise<RankingData> {
  const period = rankingPeriod(range, today)
  const call = (count = false) =>
    client.rpc('product_sales_ranking', period, count ? { count: 'exact' } : undefined) as unknown as RankingQuery

  const sold = (ascending: boolean) =>
    call()
      .select(COLUMNS)
      .gt('quantity_sold', 0)
      .order(metric, { ascending })
      .order('name', { ascending: true })
      .limit(RANKING_SIZE)

  // Sin ventas: con stock, y cargados antes del período (un producto nuevo no tuvo tiempo de venderse).
  const idle = call(true)
    .select(COLUMNS)
    .eq('quantity_sold', 0)
    .gt('stock_quantity', 0)
    .lt('product_created_at', `${period.p_from}T00:00:00-03:00`)
    .order('last_sold_at', { ascending: true, nullsFirst: true })
    .order('stock_quantity', { ascending: false })
    .limit(IDLE_SIZE)

  const [top, bottom, still] = await Promise.all([sold(false), sold(true), idle])
  for (const res of [top, bottom, still]) if (res.error) throw res.error
  const rows = (res: { data: unknown }) => ((res.data ?? []) as RankingRow[]).map(normalize)
  const idleRows = rows(still)
  return { top: rows(top), bottom: rows(bottom), idle: idleRows, idleCount: still.count ?? idleRows.length }
}
