import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegisteredSale, RegisterSaleParams } from '../pos/pos-api'

/* Clientes y cuentas corrientes: nombres del contrato v0.13.0, §23. */

export const CUSTOMERS_KEY = ['customers'] as const

export interface CustomerBalance {
  customer_id: string
  name: string
  document_number: string | null
  phone: string | null
  address: string | null
  notes: string | null
  credit_limit: number
  is_blocked: boolean
  blocked_reason: string | null
  is_active: boolean
  over_limit_authorized_until: string | null
  balance: number
  available_credit: number
  last_charge_at: string | null
  last_payment_at: string | null
}

export interface AccountMovement {
  kind: 'charge' | 'payment'
  movement_id: string
  created_at: string
  amount: number
  sale_number: number | null
  payment_method_name: string | null
  reference: string | null
  over_limit: boolean
  voided_at: string | null
  void_reason: string | null
}

export interface CustomerInput {
  name: string
  document_number: string | null
  phone: string | null
  address: string | null
  notes: string | null
  credit_limit: number
  is_blocked: boolean
  blocked_reason: string | null
  is_active: boolean
}

const BALANCE_COLUMNS =
  'customer_id, name, document_number, phone, address, notes, credit_limit, is_blocked, blocked_reason, is_active, ' +
  'over_limit_authorized_until, balance, available_credit, last_charge_at, last_payment_at'

const toBalance = (r: CustomerBalance): CustomerBalance => ({
  ...r,
  credit_limit: Number(r.credit_limit),
  balance: Number(r.balance),
  available_credit: Number(r.available_credit),
})

export async function fetchCustomers(client: SupabaseClient): Promise<CustomerBalance[]> {
  const { data, error } = await client.from('v_customer_balances').select(BALANCE_COLUMNS).order('name')
  if (error) throw error
  return ((data ?? []) as unknown as CustomerBalance[]).map(toBalance)
}

export async function fetchCustomer(client: SupabaseClient, id: string): Promise<CustomerBalance> {
  const { data, error } = await client.from('v_customer_balances').select(BALANCE_COLUMNS).eq('customer_id', id).single()
  if (error) throw error
  return toBalance(data as unknown as CustomerBalance)
}

export async function fetchAccountMovements(client: SupabaseClient, customerId: string): Promise<AccountMovement[]> {
  const { data, error } = await client
    .from('v_customer_account_movements')
    .select('kind, movement_id, created_at, amount, sale_number, payment_method_name, reference, over_limit, voided_at, void_reason')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as AccountMovement[]).map((m) => ({ ...m, amount: Number(m.amount) }))
}

export async function createCustomer(client: SupabaseClient, input: CustomerInput): Promise<void> {
  const { error } = await client.from('customers').insert(input)
  if (error) throw error
}

export async function updateCustomer(client: SupabaseClient, id: string, input: CustomerInput): Promise<void> {
  const { error } = await client.from('customers').update(input).eq('id', id)
  if (error) throw error
}

export async function authorizeOverLimit(client: SupabaseClient, customerId: string): Promise<void> {
  const { error } = await client.rpc('authorize_customer_over_limit', { p_customer_id: customerId })
  if (error) throw error
}

export interface CustomerPaymentParams {
  p_idempotency_key: string
  p_cash_session_id: string
  p_customer_id: string
  p_payment_method_id: string
  p_amount: number
  p_tendered_amount: number | null
  p_reference: string | null
  p_notes: string | null
}

export async function registerCustomerPayment(client: SupabaseClient, params: CustomerPaymentParams): Promise<void> {
  const { error } = await client.rpc('register_customer_payment', params)
  if (error) throw error
}

export async function voidCustomerPayment(client: SupabaseClient, paymentId: string, reason: string): Promise<void> {
  const { error } = await client.rpc('void_customer_payment', { p_payment_id: paymentId, p_reason: reason })
  if (error) throw error
}

/** Venta fiada (§23.3): la base registra la venta y el cargo al cliente en una sola transacción. */
export async function registerAccountSale(
  client: SupabaseClient,
  params: RegisterSaleParams & { p_customer_id: string; p_allow_over_limit: boolean },
): Promise<RegisteredSale> {
  const { data, error } = await client.rpc('register_account_sale', params).single()
  if (error) throw error
  const row = data as RegisteredSale
  return { ...row, total_amount: Number(row.total_amount) }
}
