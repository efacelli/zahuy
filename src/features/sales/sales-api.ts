import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from '../../lib/errors'
import { DEFAULT_PAGE_SIZE, pageRange } from '../../lib/pagination'
import type { TicketData } from '../pos/TicketBody'

/*
 * Historial de ventas (contrato §15.3.4 a §15.3.6). La RLS decide qué se ve:
 * el empleado, solo sus ventas; el encargado y el dueño, todas (§15.7).
 */

export const SALE_STATUSES = ['completed', 'voided'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  completed: 'Completada',
  voided: 'Anulada',
}

export interface SaleRow {
  id: string
  sale_number: number
  created_at: string
  status: SaleStatus
  total_amount: number
  rounding_amount: number
  notes: string | null
  voided_at: string | null
  void_reason: string | null
  /** null si la RLS no deja leer la sesión (empleado, sesión cerrada de otra persona). */
  cash_session: { status: 'open' | 'closed'; cash_register: { name: string } | null } | null
  seller: { full_name: string } | null
  voider: { full_name: string } | null
  sale_items: {
    product_name: string
    /** null en las líneas libres (§20.8). */
    product_sku: string | null
    quantity: number
    vat_rate: number
    /** list = precio de Zahuy; manual = importe de la etiqueta de balanza; free = producto sin cargar (§20). */
    price_source: PriceSource
    /** Con `manual`: lo que daba el precio de Zahuy en ese momento. */
    catalog_line_total: number | null
    unit_price_with_vat: number
    line_total: number
    /** Descuento por cantidad (§16.2); 0 en ventas anteriores. */
    discount_percent: number
    discount_amount: number
  }[]
  sale_payments: {
    amount: number
    tendered_amount: number | null
    reference: string | null
    payment_method: { name: string; is_cash: boolean; sort_order: number } | null
  }[]
}

export type PriceSource = 'list' | 'manual' | 'free'

const ITEM_COLUMNS = 'product_name, product_sku, quantity, vat_rate, unit_price_with_vat, line_total, discount_percent, discount_amount'

const saleColumns = (itemColumns: string) =>
  'id, sale_number, created_at, status, total_amount, rounding_amount, notes, voided_at, void_reason, ' +
  'cash_session:cash_sessions(status, cash_register:cash_registers(name)), ' +
  'seller:profiles!sales_created_by_fkey(full_name), ' +
  'voider:profiles!sales_voided_by_fkey(full_name), ' +
  `sale_items(${itemColumns}), ` +
  'sale_payments(amount, tendered_amount, reference, payment_method:payment_methods(name, is_cash, sort_order))'

/** Con las columnas de §20; si la base todavía no las tiene, sin ellas (todo es precio de lista). */
const SALE_COLUMNS = saleColumns(`${ITEM_COLUMNS}, price_source, catalog_line_total`)
const SALE_COLUMNS_BEFORE_S20 = saleColumns(ITEM_COLUMNS)

export interface SalesParams {
  status: SaleStatus | null
  page: number
}

/** PostgREST devuelve numeric como texto o número según la versión: se normaliza acá. */
function normalize(row: SaleRow): SaleRow {
  return {
    ...row,
    total_amount: Number(row.total_amount),
    rounding_amount: Number(row.rounding_amount),
    sale_items: (row.sale_items ?? []).map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      unit_price_with_vat: Number(i.unit_price_with_vat),
      line_total: Number(i.line_total),
      discount_percent: Number(i.discount_percent ?? 0),
      discount_amount: Number(i.discount_amount ?? 0),
      vat_rate: Number(i.vat_rate),
      price_source: i.price_source ?? 'list',
      catalog_line_total: i.catalog_line_total == null ? null : Number(i.catalog_line_total),
    })),
    sale_payments: (row.sale_payments ?? [])
      .map((p) => ({
        ...p,
        amount: Number(p.amount),
        tendered_amount: p.tendered_amount === null ? null : Number(p.tendered_amount),
      }))
      .sort((a, b) => (a.payment_method?.sort_order ?? 0) - (b.payment_method?.sort_order ?? 0)),
  }
}

export async function fetchSales(client: SupabaseClient, p: SalesParams): Promise<{ rows: SaleRow[]; total: number }> {
  const [from, to] = pageRange(p.page, DEFAULT_PAGE_SIZE)
  const query = (columns: string) => {
    let q = client.from('sales').select(columns, { count: 'exact' })
    if (p.status) q = q.eq('status', p.status)
    return q.order('created_at', { ascending: false }).order('id').range(from, to)
  }
  let { data, error, count } = await query(SALE_COLUMNS)
  if (error && isMissingColumn(error)) ({ data, error, count } = await query(SALE_COLUMNS_BEFORE_S20))
  if (error) throw error
  return { rows: ((data ?? []) as unknown as SaleRow[]).map(normalize), total: count ?? 0 }
}

/** Lo cobrado (Σ pagos) = total + redondeo (§15.3.6). */
export const chargedAmount = (sale: SaleRow) => sale.sale_payments.reduce((sum, p) => sum + p.amount, 0)

/** Una venta solo se anula mientras su caja siga abierta (§15.6, `void_sale`). */
export const canBeVoided = (sale: SaleRow) => sale.status === 'completed' && sale.cash_session?.status === 'open'

export function toTicket(sale: SaleRow): TicketData {
  const cash = sale.sale_payments.find((p) => p.payment_method?.is_cash && p.tendered_amount !== null)
  const tendered = cash?.tendered_amount ?? null
  return {
    saleNumber: sale.sale_number,
    createdAt: sale.created_at,
    registerName: sale.cash_session?.cash_register?.name ?? 'Caja',
    lines: sale.sale_items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      manual: i.price_source !== 'list',
      lineTotal: i.line_total,
      discountPercent: i.discount_percent,
      discountAmount: i.discount_amount,
    })),
    total: sale.total_amount,
    rounding: sale.rounding_amount,
    payments: sale.sale_payments.map((p) => ({ name: p.payment_method?.name ?? 'Pago', amount: p.amount })),
    tendered,
    change: cash && tendered !== null ? Math.round((tendered - cash.amount) * 100) / 100 : 0,
    voided: sale.status === 'voided',
  }
}

/** Anula la venta (§15.6): devuelve el stock a los mismos lotes con movimientos compensatorios. */
export async function voidSale(
  client: SupabaseClient,
  params: { p_idempotency_key: string; p_sale_id: string; p_reason: string },
): Promise<void> {
  const { error } = await client.rpc('void_sale', params).single()
  if (error) throw error
}
