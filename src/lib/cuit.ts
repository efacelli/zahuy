/**
 * CUIT/CUIL argentino. Se guarda como 11 dígitos sin guiones (contrato §5.4).
 * El dígito verificador detecta errores de tipeo antes de guardar.
 */

/** Quita guiones, puntos y espacios. Devuelve el texto tal cual si tiene otros caracteres. */
export function normalizeCuit(raw: string): string {
  return raw.trim().replace(/[\s.-]/g, '')
}

export function isValidCuit(raw: string): boolean {
  const cuit = normalizeCuit(raw)
  if (!/^\d{11}$/.test(cuit)) return false
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const digits = cuit.split('').map(Number)
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0)
  const mod = 11 - (sum % 11)
  // Con el prefijo correcto (20, 23, 27, 30, 33…) el resultado nunca es 10.
  if (mod === 10) return false
  const check = mod === 11 ? 0 : mod
  return check === digits[10]
}

/** '20123456786' → '20-12345678-6'. */
export function formatCuit(cuit: string | null | undefined): string {
  if (!cuit) return '—'
  const c = normalizeCuit(cuit)
  return /^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : cuit
}
