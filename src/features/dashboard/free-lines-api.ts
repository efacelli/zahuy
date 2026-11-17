import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from '../../lib/errors'
import { lastDays } from './finance-api'

/*
 * Productos sin cargar vendidos en la caja (contrato §20.6 y §20.8): para que el
 * encargado decida cuáles dar de alta como producto. Solo ventas completadas.
 */

export interface FreeLineRow {
  key: string
  description: string
  quantity: number
  vatRate: number
  total: number
  saleNumber: number
  createdAt: string
  seller: string | null
}

export const FREE_LINES_LIMIT = 30

interface SaleWithFreeItems {
  id: string
  sale_number: number
  created_at: string
  seller: { full_name: string } | null
  sale_items: { id: string; product_name: string; quantity: number; vat_rate: number; line_total: number }[]
}

/** `null` si la base todavía no tiene la migración de §20. */
export async function fetchRecentFreeLines(client: SupabaseClient, range: number, today = new Date()): Promise<FreeLineRow[] | null> {
  const firstDay = lastDays(range, today)[0]!
  const { data, error } = await client
    .from('sales')
    .select(
      'id, sale_number, created_at, seller:profiles!sales_created_by_fkey(full_name), ' +
        'sale_items!inner(id, product_name, quantity, vat_rate, line_total)',
    )
    .eq('status', 'completed')
    .eq('sale_items.price_source', 'free')
    .gte('created_at', new Date(`${firstDay}T00:00:00-03:00`).toISOString())
    .order('created_at', { ascending: false })
    .limit(FREE_LINES_LIMIT)
  if (error) {
    if (isMissingColumn(error)) return null
    throw error
  }
  return ((data ?? []) as unknown as SaleWithFreeItems[]).flatMap((s) =>
    s.sale_items.map((i) => ({
      key: i.id,
      description: i.product_name,
      quantity: Number(i.quantity),
      vatRate: Number(i.vat_rate),
      total: Number(i.line_total),
      saleNumber: s.sale_number,
      createdAt: s.created_at,
      seller: s.seller?.full_name ?? null,
    })),
  )
}
