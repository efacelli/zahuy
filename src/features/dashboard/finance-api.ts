import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from '../../lib/errors'
import { normalizeShift, type ShiftRow } from '../shifts/shifts-api'

/*
 * Finanzas del dashboard. Ventas, margen y medios de pago salen de
 * `v_sales_daily` y `v_sales_daily_payments` (contrato §16.4: día local de la
 * venta, solo ventas completadas); las diferencias de arqueo y las cajas
 * abiertas, de `v_cash_session_summary` (§15.5).
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
  /** Vendido con IVA (Σ `total_amount`). */
  total: number
  count: number
  /** Margen bruto: neto sin IVA menos costo de lo vendido (`gross_margin`). */
  margin: number
}

/** Fila de `v_sales_daily` (§16.4). */
export interface SalesDailyRow {
  sale_date: string
  sales_count: number
  total_amount: number
  net_amount: number
  cost_total: number
  gross_margin: number
  discount_total: number
  rounding_total: number
  /** Neto de los productos sin cargar (§20.8); no entra en el margen. Falta antes de la migración. */
  free_net_total?: number
}

/** Fila de `v_sales_daily_payments` (§16.4). */
export interface SalesDailyPaymentRow {
  sale_date: string
  payment_method_name: string
  amount_total: number
  payments_count: number
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
  /** Neto sin IVA de lo vendido. */
  netTotal: number
  costTotal: number
  /** Neto sin IVA de los productos sin cargar: sin costo conocido, fuera del margen (§20.8). */
  freeNetTotal: number
  marginTotal: number
  discountTotal: number
  roundingTotal: number
  differenceTotal: number
  openSessions: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function summarize(
  daily: SalesDailyRow[],
  payments: SalesDailyPaymentRow[],
  shifts: ShiftRow[],
  range: number,
  today = new Date(),
): FinanceData {
  const days = lastDays(range, today).map((day) => ({ day, total: 0, count: 0, margin: 0 }))
  const byDay = new Map(days.map((d) => [d.day, d]))
  let netTotal = 0
  let costTotal = 0
  let freeNetTotal = 0
  let discountTotal = 0
  let roundingTotal = 0
  for (const row of daily) {
    const d = byDay.get(row.sale_date)
    if (!d) continue
    d.total += Number(row.total_amount ?? 0)
    d.count += Number(row.sales_count ?? 0)
    d.margin += Number(row.gross_margin ?? 0)
    netTotal += Number(row.net_amount ?? 0)
    costTotal += Number(row.cost_total ?? 0)
    freeNetTotal += Number(row.free_net_total ?? 0)
    discountTotal += Number(row.discount_total ?? 0)
    roundingTotal += Number(row.rounding_total ?? 0)
  }

  const methods = new Map<string, MethodTotal>()
  for (const p of payments) {
    if (!byDay.has(p.sale_date)) continue
    const m = methods.get(p.payment_method_name) ?? { name: p.payment_method_name, total: 0, count: 0 }
    m.total += Number(p.amount_total ?? 0)
    m.count += Number(p.payments_count ?? 0)
    methods.set(p.payment_method_name, m)
  }

  const closed = shifts.filter((s) => s.status === 'closed' && s.difference !== null)
  return {
    days: days.map((d) => ({ ...d, total: round2(d.total), margin: round2(d.margin) })),
    methods: [...methods.values()].map((m) => ({ ...m, total: round2(m.total) })).sort((a, b) => b.total - a.total),
    closings: closed
      .sort((a, b) => a.opened_at.localeCompare(b.opened_at))
      .map((s) => ({ id: s.cash_session_id, label: `${s.cash_register_name} · ${localDay(s.opened_at)}`, difference: s.difference ?? 0 })),
    salesTotal: round2(days.reduce((a, d) => a + d.total, 0)),
    salesCount: days.reduce((a, d) => a + d.count, 0),
    netTotal: round2(netTotal),
    costTotal: round2(costTotal),
    freeNetTotal: round2(freeNetTotal),
    marginTotal: round2(days.reduce((a, d) => a + d.margin, 0)),
    discountTotal: round2(discountTotal),
    roundingTotal: round2(roundingTotal),
    differenceTotal: round2(closed.reduce((a, s) => a + (s.difference ?? 0), 0)),
    openSessions: shifts.filter((s) => s.status === 'open').length,
  }
}

const SHIFT_COLUMNS =
  'cash_session_id, cash_register_name, status, opened_at, closed_at, opening_amount, sales_count, sales_total, ' +
  'voided_count, cash_collected, rounding_total, expected_cash, counted_cash, difference'

const DAILY_COLUMNS = 'sale_date, sales_count, total_amount, net_amount, cost_total, gross_margin, discount_total, rounding_total'

/** Con `free_net_total` (§20.8); si la base todavía no lo tiene, sin él. */
async function fetchDaily(client: SupabaseClient, firstDay: string) {
  const query = (columns: string) => client.from('v_sales_daily').select(columns).gte('sale_date', firstDay).order('sale_date')
  const res = await query(`${DAILY_COLUMNS}, free_net_total`)
  return res.error && isMissingColumn(res.error) ? query(DAILY_COLUMNS) : res
}

export async function fetchFinance(client: SupabaseClient, range: FinanceRange, today = new Date()): Promise<FinanceData> {
  const firstDay = lastDays(range, today)[0]!
  // Los turnos se piden desde un día antes: un turno abierto la noche anterior cierra dentro del período.
  const since = new Date(`${firstDay}T00:00:00-03:00`)
  const [daily, payments, shifts] = await Promise.all([
    fetchDaily(client, firstDay),
    client
      .from('v_sales_daily_payments')
      .select('sale_date, payment_method_name, amount_total, payments_count')
      .gte('sale_date', firstDay),
    client.from('v_cash_session_summary').select(SHIFT_COLUMNS).gte('opened_at', since.toISOString()).order('opened_at'),
  ])
  for (const res of [daily, payments, shifts]) if (res.error) throw res.error
  return summarize(
    (daily.data ?? []) as unknown as SalesDailyRow[],
    (payments.data ?? []) as unknown as SalesDailyPaymentRow[],
    ((shifts.data ?? []) as unknown as ShiftRow[]).map(normalizeShift),
    range,
    today,
  )
}
