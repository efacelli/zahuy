/**
 * Convierte lo que escribe el usuario en un número.
 * Acepta coma o punto como separador decimal ("1,5" o "1.5"), sin separador de miles.
 * Devuelve `null` si el texto no es un número válido.
 */
export function parseDecimalInput(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** Cantidad de decimales escritos (según el texto, no el número). */
export function decimalsInInput(raw: string): number {
  const text = raw.trim().replace(',', '.')
  return text.split('.')[1]?.length ?? 0
}
