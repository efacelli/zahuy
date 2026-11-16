import { isIntegerUnit, type SaleUnit } from './units'

/**
 * Descuento por cantidad (contrato v0.7.0 §16.1 y §16.3). La regla la define la
 * base (`private.suggested_discount`); esto la repite solo para mostrar en la
 * caja lo mismo que la base va a calcular. Lo que se cobra lo decide la base.
 */
export interface DiscountRule {
  /** Cada cuántas unidades sube el descuento (`quantity_discount_step`). */
  step: number
  /** Cuánto sube por escalón, en % (`quantity_discount_percent`). */
  percent: number
  /** Tope por línea, en % (`quantity_discount_max_percent`, P-41). */
  max: number
}

/** Decisión de efacelli: cada 6 unidades 5 %, tope 30 %. */
export const DEFAULT_DISCOUNT_RULE: DiscountRule = { step: 6, percent: 5, max: 30 }

/** `least(floor(quantity / step) * percent, max)`; 0 en kg y l (P-43). */
export function suggestedDiscount(quantity: number, unit: SaleUnit, rule: DiscountRule): number {
  if (!isIntegerUnit(unit) || rule.step <= 0 || quantity <= 0) return 0
  return Math.min(Math.floor(quantity / rule.step) * rule.percent, rule.max)
}

/** Entre 0 y el tope, hasta 2 decimales (si no, la base responde INVALID_DISCOUNT). */
export function discountError(percent: number, rule: DiscountRule): string | null {
  if (!Number.isFinite(percent) || percent < 0 || percent > rule.max) {
    return `El descuento tiene que estar entre 0 y ${String(rule.max).replace('.', ',')} %.`
  }
  if (Math.abs(Math.round(percent * 100) - percent * 100) > 1e-6) return 'El descuento admite hasta 2 decimales.'
  return null
}
