/**
 * Redondeo del efectivo (decisión de `efacelli` sobre P-30, contrato §15 en
 * propuesta): la parte que se paga en efectivo se redondea al múltiplo más
 * cercano (por defecto $100); lo que sobra de la mitad o más sube.
 *   1237 → 1200 · 1249 → 1200 · 1250 → 1300 · 1280 → 1300
 * Excepción (también de `efacelli`): si lo que se paga en efectivo es menos de
 * la mitad del múltiplo (menos de $50), se cobra exacto, sin redondear: 30 → 30.
 * Solo se muestra y se envía; la base vuelve a validar el monto.
 */
export const DEFAULT_CASH_STEP = 100

/** Trabaja en centavos para que 1249.99 no se convierta en 1250 por un error de coma flotante. */
export function roundCash(amount: number, step = DEFAULT_CASH_STEP): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const cents = Math.round(amount * 100)
  const stepCents = Math.round(step * 100)
  if (cents < stepCents / 2) return cents / 100
  return (Math.floor((cents + stepCents / 2) / stepCents) * stepCents) / 100
}

/** Diferencia que agrega (+) o descuenta (−) el redondeo. */
export function cashRoundingDelta(amount: number, step = DEFAULT_CASH_STEP): number {
  return Math.round((roundCash(amount, step) - amount) * 100) / 100
}
