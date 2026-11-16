import type { SupabaseClient } from '@supabase/supabase-js'
import type { CartProduct } from './cart'

/*
 * Caja: nombres de la PROPUESTA de contrato v0.6.0 (§15, PR #58). Si el
 * backend cambia algún nombre al implementarla, se ajusta solo este archivo.
 */

export const OPEN_SESSIONS_KEY = ['cash-sessions', 'open'] as const

export interface CashRegister {
  id: string
  name: string
}

export interface OpenSession {
  cash_session_id: string
  cash_register_id: string
  cash_register_name: string
  opened_at: string
  opening_amount: number
  sales_count: number
  sales_total: number
  expected_cash: number
}

export interface PaymentMethod {
  id: string
  code: string
  name: string
  is_cash: boolean
}

const SELLABLE_COLUMNS = 'id, sku, name, sale_unit, sale_price_with_vat, is_active'

type SellableRow = CartProduct & { is_active: boolean }

const toCartProduct = (row: SellableRow): CartProduct => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  sale_unit: row.sale_unit,
  sale_price_with_vat: Number(row.sale_price_with_vat),
})

/** Producto activo con ese código exacto (lector USB), o null. */
export async function findSellableByBarcode(client: SupabaseClient, code: string): Promise<CartProduct | null> {
  const { data, error } = await client.from('products').select(SELLABLE_COLUMNS).eq('barcode', code).eq('is_active', true).limit(1)
  if (error) throw error
  const row = ((data ?? []) as SellableRow[])[0]
  return row ? toCartProduct(row) : null
}

export async function fetchSellable(client: SupabaseClient, productId: string): Promise<CartProduct> {
  const { data, error } = await client.from('products').select(SELLABLE_COLUMNS).eq('id', productId).single()
  if (error) throw error
  return toCartProduct(data as SellableRow)
}

export async function fetchCashRegisters(client: SupabaseClient): Promise<CashRegister[]> {
  const { data, error } = await client.from('cash_registers').select('id, name').eq('is_active', true).order('name')
  if (error) throw error
  return (data ?? []) as CashRegister[]
}

/** Sesiones abiertas (§15.5). Cualquier usuario activo vende en cualquier sesión abierta (P-33). */
export async function fetchOpenSessions(client: SupabaseClient): Promise<OpenSession[]> {
  const { data, error } = await client
    .from('v_cash_session_summary')
    .select('cash_session_id, cash_register_id, cash_register_name, opened_at, opening_amount, sales_count, sales_total, expected_cash')
    .eq('status', 'open')
    .order('cash_register_name')
  if (error) throw error
  return ((data ?? []) as OpenSession[]).map((s) => ({
    ...s,
    opening_amount: Number(s.opening_amount),
    sales_total: Number(s.sales_total),
    expected_cash: Number(s.expected_cash),
  }))
}

export async function fetchPaymentMethods(client: SupabaseClient): Promise<PaymentMethod[]> {
  const { data, error } = await client
    .from('payment_methods')
    .select('id, code, name, is_cash')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as PaymentMethod[]
}

export async function openCashSession(
  client: SupabaseClient,
  params: { p_idempotency_key: string; p_cash_register_id: string; p_opening_amount: number },
): Promise<{ id: string }> {
  const { data, error } = await client.rpc('open_cash_session', params).single()
  if (error) throw error
  return data as { id: string }
}

export async function closeCashSession(
  client: SupabaseClient,
  params: { p_cash_session_id: string; p_counted_cash: number; p_close_notes: string | null },
): Promise<{ expected_cash: number; difference: number }> {
  const { data, error } = await client.rpc('close_cash_session', params).single()
  if (error) throw error
  const row = data as { expected_cash: number | string; difference: number | string }
  return { expected_cash: Number(row.expected_cash), difference: Number(row.difference) }
}

export interface SalePaymentParam {
  payment_method_id: string
  amount: number
  tendered_amount: number | null
  reference: string | null
}

export interface RegisterSaleParams {
  p_idempotency_key: string
  p_cash_session_id: string
  p_items: { product_id: string; quantity: number }[]
  p_payments: SalePaymentParam[]
  p_notes: string | null
}

export interface RegisteredSale {
  id: string
  sale_number: number
  total_amount: number
  created_at: string
}

/** Venta atómica e idempotente (§15.6): la base pone los precios y descuenta el stock una sola vez. */
export async function registerSale(client: SupabaseClient, params: RegisterSaleParams): Promise<RegisteredSale> {
  const { data, error } = await client.rpc('register_sale', params).single()
  if (error) throw error
  const row = data as RegisteredSale
  return { ...row, total_amount: Number(row.total_amount) }
}
