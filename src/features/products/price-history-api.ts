import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * Historial de precios de un producto (contrato v0.9.1 §19.2). Lo escribe un
 * trigger de la base; acá solo se lee. Solo lo ven encargado, dueño y programador.
 * Los precios están sin IVA.
 */

export type PriceChangeSource = 'manual' | 'bulk_increase' | 'bulk_revert'

export interface PriceHistoryRow {
  id: string
  changed_at: string
  old_sale_price: number
  new_sale_price: number
  old_cost_price: number
  new_cost_price: number
  source: PriceChangeSource
  reason: string | null
  author: { full_name: string } | null
}

export const PRICE_HISTORY_LIMIT = 20

export const PRICE_SOURCE_LABEL: Record<PriceChangeSource, string> = {
  manual: 'Edición del producto',
  bulk_increase: 'Aumento masivo',
  bulk_revert: 'Aumento deshecho',
}

export function priceHistoryKey(productId: string) {
  return ['products', 'price-history', productId] as const
}

export async function fetchPriceHistory(client: SupabaseClient, productId: string): Promise<PriceHistoryRow[]> {
  const { data, error } = await client
    .from('price_history')
    .select(
      'id, changed_at, old_sale_price, new_sale_price, old_cost_price, new_cost_price, source, reason, ' +
        'author:profiles!price_history_changed_by_fkey(full_name)',
    )
    .eq('product_id', productId)
    .order('changed_at', { ascending: false })
    .limit(PRICE_HISTORY_LIMIT)
  if (error) throw error
  return ((data ?? []) as unknown as PriceHistoryRow[]).map((r) => ({
    ...r,
    old_sale_price: Number(r.old_sale_price),
    new_sale_price: Number(r.new_sale_price),
    old_cost_price: Number(r.old_cost_price),
    new_cost_price: Number(r.new_cost_price),
  }))
}

/** Precio final con IVA, al centavo, como lo calcula la base. */
export function withVat(price: number, vatRate: number): number {
  return Math.round(price * (1 + vatRate / 100) * 100) / 100
}
