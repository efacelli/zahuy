import type { SupabaseClient } from '@supabase/supabase-js'

/** Stock actual del producto (vista §7.2, única fuente de verdad del stock). */
export async function fetchProductStock(client: SupabaseClient, productId: string): Promise<number> {
  const { data, error } = await client
    .from('v_product_stock')
    .select('product_id, stock_quantity')
    .eq('product_id', productId)
    .single()
  if (error) throw error
  return Number((data as { stock_quantity: number | string }).stock_quantity ?? 0)
}

/**
 * Guarda el código de barras de un producto que todavía no tiene (§5.5).
 * Solo encargado y dueño editan productos (§9); la base lo controla con RLS.
 * Un código repetido vuelve como 23505 sobre `products_barcode_key`.
 */
export async function assignBarcode(client: SupabaseClient, productId: string, barcode: string): Promise<void> {
  const { error } = await client.from('products').update({ barcode }).eq('id', productId).select('id').single()
  if (!error) return
  // 0 filas: RLS no dejó editar (sin permiso o usuario inactivo).
  if ((error as { code?: unknown }).code === 'PGRST116') throw { code: '42501', message: 'UPDATE_NO_ROWS' }
  throw error
}
