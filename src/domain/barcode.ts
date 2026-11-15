/**
 * Códigos de barras (EAN-8, UPC-A, EAN-13, GTIN-14) y lector USB.
 *
 * Un lector USB se comporta como un teclado: "tipea" los números muy rápido y
 * termina con Enter. Acá solo hay reglas puras; la base garantiza que el código
 * sea único (`products_barcode_key`).
 */

/** Mismo formato que acepta el alta de producto: 8 a 14 números. */
export const BARCODE_PATTERN = /^[0-9]{8,14}$/

export function normalizeBarcode(raw: string): string {
  return raw.replace(/\s+/g, '')
}

export function isBarcodeLike(raw: string): boolean {
  return BARCODE_PATTERN.test(normalizeBarcode(raw))
}

/**
 * Dígito verificador GTIN (módulo 10, pesos 3 y 1 desde la derecha).
 * `null` si el largo no es de un GTIN estándar (8, 12, 13 o 14): códigos
 * internos que no se pueden verificar.
 */
export function hasValidCheckDigit(raw: string): boolean | null {
  const code = normalizeBarcode(raw)
  if (!/^[0-9]+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return null
  const digits = [...code].map(Number)
  const check = digits.pop() as number
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Aviso (no bloquea) cuando el código parece mal leído. */
export function barcodeWarning(raw: string): string | null {
  const code = normalizeBarcode(raw)
  if (!BARCODE_PATTERN.test(code)) return null
  return hasValidCheckDigit(code) === false
    ? 'El dígito verificador no coincide: puede estar mal leído o mal tipeado. Revisalo antes de guardar.'
    : null
}

/* ------------------------------------------------------------------ */
/* Detector del lector: teclas muy seguidas que terminan en Enter      */
/* ------------------------------------------------------------------ */

/** Una persona no tipea 8 números con menos de esto entre tecla y tecla. */
export const SCAN_MAX_GAP_MS = 50

export interface ScanBuffer {
  chars: string
  lastAt: number
  /** La ráfaga trajo algo que no es un número: se descarta entera al llegar Enter. */
  invalid: boolean
}

export const EMPTY_SCAN: ScanBuffer = { chars: '', lastAt: 0, invalid: false }

/**
 * Procesa una tecla. Devuelve el nuevo estado y, si la tecla cerró una lectura
 * del lector, el código leído.
 */
export function feedScan(buffer: ScanBuffer, key: string, at: number): { buffer: ScanBuffer; code: string | null } {
  const continues = buffer.lastAt > 0 && at - buffer.lastAt <= SCAN_MAX_GAP_MS
  if (key === 'Enter') {
    const code = buffer.chars
    const fresh = at - buffer.lastAt <= SCAN_MAX_GAP_MS * 4
    return { buffer: EMPTY_SCAN, code: fresh && !buffer.invalid && BARCODE_PATTERN.test(code) ? code : null }
  }
  if (!/^[0-9]$/.test(key)) return { buffer: { chars: '', lastAt: at, invalid: true }, code: null }
  return continues
    ? { buffer: { chars: buffer.chars + key, lastAt: at, invalid: buffer.invalid }, code: null }
    : { buffer: { chars: key, lastAt: at, invalid: false }, code: null }
}
