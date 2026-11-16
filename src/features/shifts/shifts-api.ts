import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PAGE_SIZE, pageRange } from '../../lib/pagination'

/*
 * Turnos de caja (contrato §15.5): `v_cash_session_summary` y
 * `v_cash_session_payments`. Encargado y dueño ven todo; el empleado no entra
 * a esta pantalla (y la base igual le oculta el arqueo de las abiertas, P-40).
 */

export type SessionStatus = 'open' | 'closed'

export interface ShiftRow {
  cash_session_id: string
  cash_register_name: string
  status: SessionStatus
  opened_at: string
  closed_at: string | null
  opening_amount: number
  sales_count: number
  sales_total: number
  voided_count: number
  cash_collected: number | null
  rounding_total: number | null
  expected_cash: number | null
  counted_cash: number | null
  difference: number | null
  opener: { full_name: string } | null
  closer: { full_name: string } | null
}

export interface ShiftPayment {
  payment_method_id: string
  payment_method_name: string
  payments_count: number
  amount_total: number
}

const SHIFT_COLUMNS =
  'cash_session_id, cash_register_name, status, opened_at, closed_at, opening_amount, sales_count, sales_total, ' +
  'voided_count, cash_collected, rounding_total, expected_cash, counted_cash, difference, ' +
  'opener:profiles!cash_sessions_opened_by_fkey(full_name), closer:profiles!cash_sessions_closed_by_fkey(full_name)'

const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function normalizeShift(row: ShiftRow): ShiftRow {
  return {
    ...row,
    opening_amount: num(row.opening_amount),
    sales_count: num(row.sales_count),
    sales_total: num(row.sales_total),
    voided_count: num(row.voided_count),
    cash_collected: numOrNull(row.cash_collected),
    rounding_total: numOrNull(row.rounding_total),
    expected_cash: numOrNull(row.expected_cash),
    counted_cash: numOrNull(row.counted_cash),
    difference: numOrNull(row.difference),
  }
}

export interface ShiftParams {
  status: SessionStatus | null
  page: number
}

export async function fetchShifts(client: SupabaseClient, p: ShiftParams): Promise<{ rows: ShiftRow[]; total: number }> {
  let q = client.from('v_cash_session_summary').select(SHIFT_COLUMNS, { count: 'exact' })
  if (p.status) q = q.eq('status', p.status)
  const [from, to] = pageRange(p.page, DEFAULT_PAGE_SIZE)
  const { data, error, count } = await q.order('opened_at', { ascending: false }).order('cash_session_id').range(from, to)
  if (error) throw error
  return { rows: ((data ?? []) as unknown as ShiftRow[]).map(normalizeShift), total: count ?? 0 }
}

/** Cobrado por medio de pago en un turno: para conciliar con el posnet, el QR y el banco. */
export async function fetchShiftPayments(client: SupabaseClient, sessionId: string): Promise<ShiftPayment[]> {
  const { data, error } = await client
    .from('v_cash_session_payments')
    .select('payment_method_id, payment_method_name, payments_count, amount_total')
    .eq('cash_session_id', sessionId)
    .order('payment_method_name')
  if (error) throw error
  return ((data ?? []) as ShiftPayment[]).map((p) => ({
    ...p,
    payments_count: num(p.payments_count),
    amount_total: num(p.amount_total),
  }))
}

export type DifferenceKind = 'exact' | 'short' | 'over'

/** Faltante (negativo), sobrante (positivo) o justo. El texto no depende solo del color. */
export function differenceKind(difference: number): DifferenceKind {
  if (Math.abs(difference) < 0.005) return 'exact'
  return difference < 0 ? 'short' : 'over'
}

export const DIFFERENCE_LABEL: Record<DifferenceKind, string> = {
  exact: 'Justo',
  short: 'Faltante',
  over: 'Sobrante',
}
