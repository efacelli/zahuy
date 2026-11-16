import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeShift, type ShiftRow } from '../shifts/shifts-api'

/*
 * Finanzas del dashboard, con las vistas de caja que ya existen (§15.5). Las
 * ventas se agrupan por el día en que se ABRIÓ el turno. Cuando el backend
 * publique `v_sales_daily` (propuesta §16.4) esto pasa a leer esa vista, con
 * margen bruto incluido.
 */

export const FINANCE_RANGES = [7, 30, 90] as const
export type FinanceRange = (typeof FINANCE_RANGES)[number]

const TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Fecha local del súper (AAAA-MM-DD) de un instante. */
export function localDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TIME_ZONE })
}

/** Los últimos `days` días locales, del más viejo al de hoy. */
export function lastDays(days: number, today: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(localDay(new Date(today.getTime() - i * 86_400_000)))
  return out
}

export interface DayTotal {
  day: string
  total: number
  count: number
}

export interface MethodTotal {
  name: string
  total: number
  count: number
}

export interface FinanceData {
  days: DayTotal[]
  methods: MethodTotal[]
  /** Turnos cerrados del período con su diferencia, del más viejo al más nuevo. */
  closings: { id: string; label: string; difference: number }[]
  salesTotal: number
  salesCount: number
  roundingTotal: number
  differenceTotal: number
  openSessions: number
}

export function summarize(shifts: ShiftRow[], payments: { payment_method_name: string; amount_total: number; payments_count: number }[], range: number, today = new Date()): FinanceData {
  const days = lastDays(range, today).map((day) => ({ day, total: 0, count: 0 }))
  const byDay = new Map(days.map((d) => [d.day, d]))
  let roundingTotal = 0
  let differenceTotal = 0
  for (const s of shifts) {
    const d = byDay.get(localDay(s.opened_at))
    if (d) {
      d.total += s.sales_total
      d.count += s.sales_count
    }
    roundingTotal += s.rounding_total ?? 0
    differenceTotal += s.difference ?? 0
  }

  const methods = new Map<string, MethodTotal>()
  for (const p of payments) {
    const m = methods.get(p.payment_method_name) ?? { name: p.payment_method_name, total: 0, count: 0 }
    m.total += Number(p.amount_total ?? 0)
    m.count += Number(p.payments_count ?? 0)
    methods.set(p.payment_method_name, m)
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  const salesTotal = round2(days.reduce((a, d) => a + d.total, 0))
  return {
    days: days.map((d) => ({ ...d, total: round2(d.total) })),
    methods: [...methods.values()].map((m) => ({ ...m, total: round2(m.total) })).sort((a, b) => b.total - a.total),
    closings: shifts
      .filter((s) => s.status === 'closed' && s.difference !== null)
      .sort((a, b) => a.opened_at.localeCompare(b.opened_at))
      .map((s) => ({ id: s.cash_session_id, label: `${s.cash_register_name} · ${localDay(s.opened_at)}`, difference: s.difference ?? 0 })),
    salesTotal,
    salesCount: days.reduce((a, d) => a + d.count, 0),
    roundingTotal: round2(roundingTotal),
    differenceTotal: round2(differenceTotal),
    openSessions: shifts.filter((s) => s.status === 'open').length,
  }
}

const SHIFT_COLUMNS =
  'cash_session_id, cash_register_name, status, opened_at, closed_at, opening_amount, sales_count, sales_total, ' +
  'voided_count, cash_collected, rounding_total, expected_cash, counted_cash, difference'

export async function fetchFinance(client: SupabaseClient, range: FinanceRange, today = new Date()): Promise<FinanceData> {
  const since = new Date(today.getTime() - (range - 1) * 86_400_000)
  since.setUTCHours(0, 0, 0, 0)
  const { data, error } = await client
    .from('v_cash_session_summary')
    .select(SHIFT_COLUMNS)
    .gte('opened_at', since.toISOString())
    .order('opened_at')
  if (error) throw error
  const shifts = ((data ?? []) as unknown as ShiftRow[]).map(normalizeShift)
  const ids = shifts.map((s) => s.cash_session_id)
  let payments: { payment_method_name: string; amount_total: number; payments_count: number }[] = []
  if (ids.length > 0) {
    const res = await client
      .from('v_cash_session_payments')
      .select('payment_method_name, amount_total, payments_count')
      .in('cash_session_id', ids)
    if (res.error) throw res.error
    payments = (res.data ?? []) as typeof payments
  }
  return summarize(shifts, payments, range, today)
}
