import { MOVEMENT_TYPE_INFO, type MovementType } from '../../domain/movements'
import { SALE_UNIT_LABEL, isIntegerUnit, type SaleUnit } from '../../domain/units'
import { isIsoDate, todayInAppTimeZone } from '../../lib/dates'
import { decimalsInInput, parseDecimalInput } from '../../lib/numbers'

/** Validaciones previas al envío; la base vuelve a validar todo (§8). */

const MAX_QUANTITY = 999_999_999.999

export function validateQuantityText(raw: string, unit: SaleUnit, { integer = false } = {}): string | null {
  if (raw.trim() === '') return 'Ingresá la cantidad.'
  const n = parseDecimalInput(raw)
  if (n === null) return 'Ingresá un número (por ejemplo 12 o 1,5).'
  if (n <= 0) return 'La cantidad debe ser mayor que cero.'
  if ((integer || isIntegerUnit(unit)) && !Number.isInteger(n)) {
    return integer ? 'La cantidad de cajas debe ser entera.' : `Para "${SALE_UNIT_LABEL[unit]}" la cantidad debe ser entera.`
  }
  if (decimalsInInput(raw) > 3) return 'Se admiten hasta 3 decimales.'
  if (n > MAX_QUANTITY) return 'La cantidad es demasiado grande.'
  return null
}

/* ---------------------------- Ingreso ---------------------------- */

export interface ReceiveFormValues {
  quantity: string
  /** Cargar en unidades de venta o en cajas (se convierte con `units_per_box`). */
  mode: 'units' | 'boxes'
  received_on: string
  expires_on: string
  batch_number: string
  notes: string
}

export function emptyReceiveForm(today = todayInAppTimeZone()): ReceiveFormValues {
  return { quantity: '', mode: 'units', received_on: today, expires_on: '', batch_number: '', notes: '' }
}

export type FieldErrors<T> = Partial<Record<keyof T, string>>

export function validateReceive(
  v: ReceiveFormValues,
  unit: SaleUnit,
  today = todayInAppTimeZone(),
): FieldErrors<ReceiveFormValues> {
  const errors: FieldErrors<ReceiveFormValues> = {}
  const q = validateQuantityText(v.quantity, unit, { integer: v.mode === 'boxes' })
  if (q) errors.quantity = q
  if (!isIsoDate(v.received_on)) errors.received_on = 'Ingresá la fecha de ingreso.'
  else if (v.received_on > today) errors.received_on = 'La fecha de ingreso no puede ser futura.'
  if (v.expires_on === '') errors.expires_on = 'Indicá la fecha de vencimiento.'
  else if (!isIsoDate(v.expires_on)) errors.expires_on = 'La fecha de vencimiento no es válida.'
  if (v.batch_number.trim().length > 60) errors.batch_number = 'El número de lote admite hasta 60 caracteres.'
  if (v.notes.length > 500) errors.notes = 'Las observaciones admiten hasta 500 caracteres.'
  return errors
}

/** Cantidad en unidades de venta que se envía a `receive_stock`. */
export function receiveQuantity(v: ReceiveFormValues, unitsPerBox: number): number {
  const n = parseDecimalInput(v.quantity) ?? 0
  return v.mode === 'boxes' ? n * unitsPerBox : n
}

/* ------------------------- Salida o ajuste ------------------------ */

export interface MovementFormValues {
  movement_type: MovementType
  quantity: string
  reason: string
  notes: string
  /** `datetime-local` (hora del equipo). Vacío = ahora. */
  occurred_at: string
}

const MAX_DELAY_DAYS = 7 // Contrato P-11.
const CLOCK_TOLERANCE_MS = 5 * 60_000

export function validateMovement(
  v: MovementFormValues,
  unit: SaleUnit,
  now: Date = new Date(),
): FieldErrors<MovementFormValues> {
  const errors: FieldErrors<MovementFormValues> = {}
  const q = validateQuantityText(v.quantity, unit)
  if (q) errors.quantity = q
  if (MOVEMENT_TYPE_INFO[v.movement_type].reasonRequired && v.reason.trim() === '') {
    errors.reason = 'Indicá el motivo.'
  }
  if (v.reason.length > 300) errors.reason = 'El motivo admite hasta 300 caracteres.'
  if (v.occurred_at !== '') {
    const when = new Date(v.occurred_at)
    if (Number.isNaN(when.getTime())) errors.occurred_at = 'La fecha no es válida.'
    else if (when.getTime() > now.getTime() + CLOCK_TOLERANCE_MS) errors.occurred_at = 'La fecha no puede ser futura.'
    else if (when.getTime() < now.getTime() - MAX_DELAY_DAYS * 86_400_000) {
      errors.occurred_at = 'Se puede cargar con hasta 7 días de atraso.'
    }
  }
  return errors
}

/** `datetime-local` → ISO con zona, o null si está vacío (la base usa `now()`). */
export function occurredAtParam(value: string): string | null {
  return value === '' ? null : new Date(value).toISOString()
}

const optional = (v: string) => (v.trim() === '' ? null : v.trim())
export { optional }
