import { DEFAULT_CASH_STEP, roundCash } from '../../domain/cash-rounding'
import { formatMoney } from '../../lib/format'
import { parseDecimalInput } from '../../lib/numbers'
import type { PaymentMethod, SalePaymentParam } from './pos-api'

/** Una fila del cobro tal como la edita el cajero (textos de los campos). */
export interface PaymentDraft {
  method: PaymentMethod
  /** Monto de este medio. Solo se escribe cuando se combinan medios. */
  amount: string
  /** Solo efectivo: lo que entregó el cliente (vacío = justo). */
  tendered: string
  reference: string
}

export interface PaymentPlan {
  /** Monto sugerido: el total redondeado (P-30). */
  suggested: number
  /** Lo que paga el cliente: el sugerido o lo que escribió el cajero. */
  toPay: number
  /** toPay − total: lo que agrega (+) o descuenta (−) el redondeo. */
  rounding: number
  /** Efectivo a cobrar (lo que no cubren los otros medios). 0 si no hay efectivo. */
  cashAmount: number
  change: number
  errors: string[]
  payments: SalePaymentParam[]
}

const money = (n: number) => Math.round(n * 100) / 100

/**
 * Arma los pagos de `register_sale`. Decisión de `efacelli` (P-30): el total de
 * la venta se redondea a la centena con cualquier medio de pago (menos de $50,
 * exacto), y el cajero puede cambiar el monto a cobrar por las dudas. El
 * cambio no puede alejarse del total en un múltiplo entero o más.
 *
 * Con un solo medio, ese medio paga todo. Con varios, se escriben los montos de
 * los que no son efectivo y el efectivo cubre lo que falta.
 */
export function planPayments(total: number, drafts: PaymentDraft[], charged = '', step = DEFAULT_CASH_STEP): PaymentPlan {
  const errors: string[] = []
  const suggested = roundCash(total, step)

  let toPay = suggested
  if (charged.trim() !== '') {
    const n = parseDecimalInput(charged)
    if (n === null || n <= 0) errors.push('El monto a cobrar no es válido.')
    else toPay = money(n)
  }
  const rounding = money(toPay - total)
  if (Math.abs(rounding) >= step) {
    errors.push(`El monto a cobrar no puede diferir del total en ${formatMoney(step)} o más.`)
  }

  if (drafts.length === 0) errors.push('Elegí al menos un medio de pago.')
  const single = drafts.length === 1
  const cash = drafts.find((d) => d.method.is_cash)
  const nonCash = drafts.filter((d) => !d.method.is_cash)

  const amounts = new Map<string, number>()
  let nonCashSum = 0
  for (const d of nonCash) {
    const n = single ? toPay : parseDecimalInput(d.amount)
    if (n === null || n <= 0) errors.push(`Indicá el monto de ${d.method.name}.`)
    else {
      amounts.set(d.method.id, money(n))
      nonCashSum = money(nonCashSum + n)
    }
  }

  const cashAmount = cash ? money(Math.max(toPay - nonCashSum, 0)) : 0
  if (nonCashSum > toPay) errors.push('Los pagos superan el monto a cobrar.')
  else if (cash && !single && cashAmount === 0) errors.push('El efectivo no cubre nada: quitalo o bajá los otros montos.')
  if (!cash && nonCash.length > 0 && errors.length === 0 && nonCashSum !== toPay) {
    errors.push(`Faltan ${formatMoney(money(toPay - nonCashSum))} para completar el monto a cobrar.`)
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
      amount: amounts.get(d.method.id) ?? 0,
      tendered_amount: null,
      reference: d.reference.trim() === '' ? null : d.reference.trim(),
    })),
    ...(cash && cashAmount > 0
      ? [{ payment_method_id: cash.method.id, amount: cashAmount, tendered_amount: tendered ?? cashAmount, reference: null }]
      : []),
  ]

  return { suggested, toPay, rounding, cashAmount, change, errors, payments }
}
