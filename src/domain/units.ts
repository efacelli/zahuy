/** Contrato §4.2 (v0.3.0). */
export const SALE_UNITS = ['unit', 'kg', 'l', 'pack', 'box', 'other'] as const
export type SaleUnit = (typeof SALE_UNITS)[number]

export const SALE_UNIT_LABEL: Record<SaleUnit, string> = {
  unit: 'Unidad',
  kg: 'Kilo',
  l: 'Litro',
  pack: 'Pack',
  box: 'Caja',
  other: 'Otra',
}

const UNIT_SUFFIX: Record<SaleUnit, string> = {
  unit: 'u.',
  kg: 'kg',
  l: 'l',
  pack: 'pack',
  box: 'cajas',
  other: '',
}

const INTEGER_UNITS: ReadonlySet<SaleUnit> = new Set<SaleUnit>(['unit', 'pack', 'box', 'other'])

/** Máximo de decimales admitidos por la base: numeric(12,3). */
const MAX_DECIMALS = 3
const MAX_QUANTITY = 999_999_999.999

export function isIntegerUnit(unit: SaleUnit): boolean {
  return INTEGER_UNITS.has(unit)
}

/**
 * Validación previa al envío (la base vuelve a validar).
 * Devuelve un mensaje de error o `null` si la cantidad es válida.
 */
export function validateQuantity(unit: SaleUnit, quantity: number): string | null {
  if (!Number.isFinite(quantity)) return 'Ingresá un número.'
  if (quantity <= 0) return 'La cantidad debe ser mayor que cero.'
  if (quantity > MAX_QUANTITY) return 'La cantidad es demasiado grande.'
  if (isIntegerUnit(unit) && !Number.isInteger(quantity)) {
    return `Para "${SALE_UNIT_LABEL[unit]}" la cantidad debe ser un número entero.`
  }
  if (decimalPlaces(quantity) > MAX_DECIMALS) return 'Se admiten hasta 3 decimales.'
  return null
}

export function formatQuantity(quantity: number | null | undefined, unit: SaleUnit): string {
  if (quantity === null || quantity === undefined || Number.isNaN(quantity)) return '—'
  const number = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: isIntegerUnit(unit) ? 0 : MAX_DECIMALS,
  }).format(quantity)
  const suffix = UNIT_SUFFIX[unit]
  return suffix ? `${number} ${suffix}` : number
}

function decimalPlaces(value: number): number {
  const text = value.toString()
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.split('.')[1]?.length ?? 0
}
