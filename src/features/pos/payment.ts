import { roundCash } from '../../domain/cash-rounding'
import { formatMoney } from '../../lib/format'
import { parseDecimalInput } from '../../lib/numbers'
import type { PaymentMethod, SalePaymentParam } from './pos-api'

/** Una fila del cobro tal como la edita el cajero (textos de los campos). */
export interface PaymentDraft {
  method: PaymentMethod
  /** Solo medios que no son efectivo: el efectivo se calcula solo. */
  amount: string
  /** Solo efectivo: lo que entregó el cliente (vacío = justo). */
  tendered: string
  reference: string
}

export interface PaymentPlan {
  /** Lo que falta cubrir después de los pagos que no son efectivo. */
  cashDue: number
  /** Efectivo a cobrar, redondeado (P-30). 0 si no hay fila de efectivo. */
  cashAmount: number
  /** cashAmount − cashDue: lo que agrega (+) o descuenta (−) el redondeo. */
  rounding: number
  change: number
  /** Total que paga el cliente (total de la venta + redondeo). */
  toPay: number
  errors: string[]
  payments: SalePaymentParam[]
}

const money = (n: number) => Math.round(n * 100) / 100

/**
 * Arma los pagos de `register_sale`. Regla del redondeo propuesta para §15
 * (comentario en el PR #58): el efectivo cubre lo que falta y se redondea; la
 * base lo vuelve a calcular y lo exige.
 */
export function planPayments(total: number, drafts: PaymentDraft[], step?: number): PaymentPlan {
  const errors: string[] = []
  const nonCash = drafts.filter((d) => !d.method.is_cash)
  const cash = drafts.find((d) => d.method.is_cash)

  let nonCashSum = 0
  for (const d of nonCash) {
    const n = parseDecimalInput(d.amount)
    if (n === null || n <= 0) errors.push(`Indicá el monto de ${d.method.name}.`)
    else nonCashSum = money(nonCashSum + n)
  }

  const cashDue = money(Math.max(total - nonCashSum, 0))
  const cashAmount = cash ? roundCash(cashDue, step) : 0
  const rounding = cash ? money(cashAmount - cashDue) : 0

  if (drafts.length === 0) errors.push('Elegí al menos un medio de pago.')
  if (nonCashSum > total) errors.push('Los pagos superan el total.')
  if (!cash && nonCash.length > 0 && errors.length === 0 && nonCashSum !== total) {
    errors.push(`Faltan ${formatMoney(money(total - nonCashSum))} para completar el total.`)
  }

  let tendered: number | null = null
  if (cash && cash.tendered.trim() !== '') {
    tendered = parseDecimalInput(cash.tendered)
    if (tendered === null) errors.push('El efectivo recibido no es un número.')
    else if (tendered < cashAmount) errors.push('El efectivo recibido es menor que lo que hay que cobrar.')
  }
  const change = tendered !== null && tendered >= cashAmount ? money(tendered - cashAmount) : 0

  const payments: SalePaymentParam[] = [
    ...nonCash.map((d) => ({
      payment_method_id: d.method.id,
      amount: parseDecimalInput(d.amount) ?? 0,
      tendered_amount: null,
      reference: d.reference.trim() === '' ? null : d.reference.trim(),
    })),
    ...(cash && cashAmount > 0
      ? [{ payment_method_id: cash.method.id, amount: cashAmount, tendered_amount: tendered ?? cashAmount, reference: null }]
      : []),
  ]

  return { cashDue, cashAmount, rounding, change, toPay: money(total + rounding), errors, payments }
}
