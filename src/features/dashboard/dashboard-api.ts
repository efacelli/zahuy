import type { SupabaseClient } from '@supabase/supabase-js'

/** Fila de `v_inventory_summary` (contrato v0.4.4 §7.4). */
export interface InventorySummary {
  active_products: number
  low_stock_products: number
  expiring_products: number
  expired_batches: number
  stock_value_cost: number
  stock_value_sale: number
  shrinkage_quantity_month: number
  box_mismatch_products: number
  /** v0.4.4 (P-21): mermas del mes sin anuladas, a costo sin IVA. */
  shrinkage_value_month: number
}

const COLUMNS =
  'active_products, low_stock_products, expiring_products, expired_batches, stock_value_cost, ' +
  'stock_value_sale, shrinkage_quantity_month, box_mismatch_products, shrinkage_value_month'

/**
 * La vista devuelve una fila solo a encargado y dueño (el filtro está en la base).
 * `null` = la base no devolvió datos para este usuario.
 */
export async function fetchInventorySummary(client: SupabaseClient): Promise<InventorySummary | null> {
  const { data, error } = await client.from('v_inventory_summary').select(COLUMNS).limit(1)
  if (error) throw error
  const rows = (data ?? []) as unknown as InventorySummary[]
  return rows[0] ?? null
}
