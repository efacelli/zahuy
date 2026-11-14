/**
 * Fechas de la app. "Hoy" siempre se calcula en la zona horaria de Argentina
 * (contrato §2.4): en UTC un lote figuraría vencido desde las 21:00 del día anterior.
 *
 * - Fechas sin hora (`date` en PostgreSQL) viajan como 'YYYY-MM-DD' y se tratan
 *   como texto, sin convertirlas a `Date` local (evita corrimientos de un día).
 * - Instantes (`timestamptz`) viajan como ISO 8601 y se muestran en hora argentina.
 */

export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Fecha de hoy en Argentina, como 'YYYY-MM-DD'. */
export function todayInAppTimeZone(now: Date = new Date()): string {
  return isoDateFormatter.format(now)
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. Devuelve '—' si no hay fecha. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const match = ISO_DATE.exec(isoDate)
  if (!match) return isoDate
  return `${match[3]}/${match[2]}/${match[1]}`
}

/** Instante ISO → 'DD/MM/YYYY HH:mm' en hora argentina. */
export function formatDateTime(isoInstant: string | null | undefined): string {
  if (!isoInstant) return '—'
  const date = new Date(isoInstant)
  if (Number.isNaN(date.getTime())) return isoInstant
  return dateTimeFormatter.format(date).replace(',', '')
}

/** Días entre hoy (Argentina) y una fecha 'YYYY-MM-DD'. Negativo si ya pasó. */
export function daysUntil(isoDate: string, today: string = todayInAppTimeZone()): number {
  if (!isIsoDate(isoDate) || !isIsoDate(today)) {
    throw new RangeError(`Fecha inválida: ${isoDate} / ${today}`)
  }
  return Math.round((toUtcMs(isoDate) - toUtcMs(today)) / 86_400_000)
}

function toUtcMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}
