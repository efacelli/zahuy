/**
 * Lectura de la exportación del sistema anterior (contrato v0.5.0, P-24 a P-26).
 *
 * Columnas esperadas (el orden no importa; se reconocen por nombre, sin tildes
 * ni mayúsculas): Codigo Propio, Descripcion, Costo, Iva, Publico y Fecha
 * Actualizacion. "Publico" es el precio final de góndola, con IVA.
 *
 * Solo lógica pura: no toca la base. La importación llama a `create_product`.
 */

export interface LegacyItem {
  /** Fila del archivo (1 = primera línea), para los mensajes. */
  line: number
  legacyCode: string
  name: string
  costPrice: number
  /** Precio final con IVA, tal cual el sistema anterior. */
  finalPrice: number
  vatRate: 21 | 10.5
  /** Precio sin IVA con 4 decimales: reproduce exacto el precio final (P-24). */
  salePrice: number
  updatedOn: string | null
}

export interface RowProblem {
  line: number
  legacyCode: string | null
  message: string
}

export interface ParsedLegacyFile {
  items: LegacyItem[]
  problems: RowProblem[]
  totalRows: number
}

/* ---------------------------- Texto y CSV ---------------------------- */

/** UTF-8 si es válido; si no, Windows-1252 (Excel en castellano guarda así los CSV "comunes"). */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export function detectDelimiter(text: string): ';' | ',' | '\t' {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n')
  const count = (c: string) => sample.split(c).length - 1
  const candidates: [';' | ',' | '\t', number][] = [
    [';', count(';')],
    ['\t', count('\t')],
    [',', count(',')],
  ]
  candidates.sort((a, b) => b[1] - a[1])
  return candidates[0]?.[1] ? candidates[0][0] : ','
}

/** CSV con comillas dobles (RFC 4180). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        quoted = false
      } else {
        field += c
      }
    } else if (c === '"' && field === '') {
      quoted = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/* --------------------------- Números y fechas --------------------------- */

/**
 * Con `;` como separador (Excel en castellano) la coma es decimal y el punto,
 * de miles. Con `,` como separador, el punto es decimal.
 */
export function parseNumber(raw: string, decimalComma: boolean): number | null {
  let t = raw.trim().replace(/\$|\s/g, '')
  if (t === '') return null
  t = decimalComma ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** dd/mm/aaaa (con o sin hora) o aaaa-mm-dd → aaaa-mm-dd. */
export function parseDate(raw: string): string | null {
  const t = raw.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t)
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  }
  return null
}

/** sale_price sin IVA con 4 decimales a partir del precio final (contrato §5.5, P-24). */
export function salePriceFromFinal(finalPrice: number, vatRate: number): number {
  return Math.round((finalPrice / (1 + vatRate / 100)) * 10_000) / 10_000
}

/** Lo que calcula la base: round(sale_price * (1 + IVA/100), 2). */
export function finalPriceFromSale(salePrice: number, vatRate: number): number {
  return Math.round(salePrice * (1 + vatRate / 100) * 100) / 100
}

/* ------------------------------ Archivo ------------------------------ */

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const REQUIRED = {
  code: 'codigo propio',
  name: 'descripcion',
  cost: 'costo',
  vat: 'iva',
  final: 'publico',
} as const
const OPTIONAL_DATE = 'fecha actualizacion'

export function parseLegacyFile(text: string): ParsedLegacyFile {
  const delimiter = detectDelimiter(text)
  const decimalComma = delimiter === ';'
  const rows = parseCsv(text, delimiter)
  const headerIndex = rows.slice(0, 15).findIndex((r) => r.map(normalize).includes(REQUIRED.name))
  if (headerIndex < 0) {
    return {
      items: [],
      totalRows: 0,
      problems: [{ line: 1, legacyCode: null, message: 'No se encontró la fila de títulos (falta la columna "Descripcion").' }],
    }
  }
  const header = rows[headerIndex]!.map(normalize)
  const col = (name: string) => header.indexOf(name)
  const missing = Object.values(REQUIRED).filter((n) => col(n) < 0)
  if (missing.length > 0) {
    return {
      items: [],
      totalRows: 0,
      problems: [{ line: headerIndex + 1, legacyCode: null, message: `Faltan columnas: ${missing.join(', ')}.` }],
    }
  }

  const items: LegacyItem[] = []
  const problems: RowProblem[] = []
  const seen = new Map<string, number>()
  let totalRows = 0

  rows.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + 2 + i
    if (r.every((c) => c.trim() === '')) return
    totalRows++
    const cell = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '') : '')
    const legacyCode = cell(REQUIRED.code).trim()
    const name = cell(REQUIRED.name).trim().replace(/\s+/g, ' ')
    const cost = parseNumber(cell(REQUIRED.cost), decimalComma)
    const vat = parseNumber(cell(REQUIRED.vat), decimalComma)
    const finalPrice = parseNumber(cell(REQUIRED.final), decimalComma)
    const problem = (message: string) => problems.push({ line, legacyCode: legacyCode || null, message })

    if (legacyCode === '') return problem('Falta el código propio.')
    if (legacyCode.length > 40) return problem('El código propio tiene más de 40 caracteres.')
    if (name === '') return problem('Falta la descripción.')
    if (name.length > 150) return problem('La descripción tiene más de 150 caracteres.')
    if (vat !== 21 && vat !== 10.5) return problem(`IVA no admitido (${cell(REQUIRED.vat)}); solo 21 o 10,5.`)
    if (finalPrice === null || finalPrice <= 0) return problem('El precio al público falta o es cero.')
    if (cost === null || cost < 0) return problem('El costo falta o es negativo.')
    const key = legacyCode.toUpperCase()
    if (seen.has(key)) return problem(`Código propio repetido en el archivo (también en la fila ${seen.get(key)}).`)
    seen.set(key, line)

    const salePrice = salePriceFromFinal(finalPrice, vat)
    items.push({
      line,
      legacyCode,
      name,
      costPrice: Math.round(cost * 100) / 100,
      finalPrice: Math.round(finalPrice * 100) / 100,
      vatRate: vat,
      salePrice,
      updatedOn: col(OPTIONAL_DATE) >= 0 ? parseDate(cell(OPTIONAL_DATE)) : null,
    })
  })

  return { items, problems, totalRows }
}

/** P-26: solo lo actualizado desde una fecha. Sin fecha en el archivo, no filtra. */
export function filterSince(items: LegacyItem[], since: string | null): LegacyItem[] {
  if (!since) return items
  return items.filter((i) => i.updatedOn === null || i.updatedOn >= since)
}

/**
 * Clave de idempotencia estable por código: reimportar el mismo archivo no
 * duplica (create_product devuelve el producto ya creado, §8.4).
 */
export async function idempotencyKeyFor(legacyCode: string): Promise<string> {
  const data = new TextEncoder().encode(`zahuy-import:${legacyCode.toUpperCase()}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50 // versión 5 (basada en nombre)
  hash[8] = (hash[8]! & 0x3f) | 0x80 // variante RFC 4122
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
