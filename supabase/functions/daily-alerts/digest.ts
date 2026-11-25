// Resumen diario de vencimientos para el encargado (WhatsApp y email). Lógica pura, sin red: se prueba con Deno.
// Lee filas de `v_batch_status` (contrato §7.1): solo lotes con stock y en alerta (nunca agotados ni sin vencimiento).

export type AlertStatus = 'expired' | 'expires_urgent' | 'expires_soon' | 'expires_upcoming'

export const ALERT_STATUSES: AlertStatus[] = ['expired', 'expires_urgent', 'expires_soon', 'expires_upcoming']

export interface BatchRow {
  product_name: string
  product_sku: string
  batch_number: string | null
  expires_on: string
  days_to_expiry: number
  expiry_status: AlertStatus
  quantity_available: number | string
  sale_unit: string
  category_name: string | null
}

export const GROUP_TITLE: Record<AlertStatus, string> = {
  expired: 'Vencidos con stock',
  expires_urgent: 'Vencimiento urgente',
  expires_soon: 'Vencen pronto',
  expires_upcoming: 'Próximos a vencer',
}

export interface Digest {
  total: number
  counts: Record<AlertStatus, number>
  subject: string
  whatsapp: string
  html: string
  text: string
}

/** Máximo de productos por grupo en el WhatsApp (el detalle completo va por email y en la app). */
const WHATSAPP_PER_GROUP = 8

const formatDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function formatQuantity(q: number | string, unit: string): string {
  const n = Number(q)
  if (unit === 'kg') return `${n.toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg`
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 3 })} u`
}

export function whenText(days: number): string {
  if (days < -1) return `venció hace ${-days} días`
  if (days === -1) return 'venció ayer'
  if (days === 0) return 'vence hoy'
  if (days === 1) return 'vence mañana'
  return `vence en ${days} días`
}

function line(r: BatchRow): string {
  const lot = r.batch_number ? ` (lote ${r.batch_number})` : ''
  return `${r.product_name}${lot} — ${formatQuantity(r.quantity_available, r.sale_unit)} — ${whenText(r.days_to_expiry)} (${formatDate(r.expires_on)})`
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Arma el resumen. `today` es la fecha de Argentina (AAAA-MM-DD); `appUrl`, la pantalla de Alertas. */
export function buildDigest(rows: BatchRow[], today: string, appUrl: string): Digest {
  const groups = Object.fromEntries(ALERT_STATUSES.map((s) => [s, [] as BatchRow[]])) as Record<AlertStatus, BatchRow[]>
  for (const r of rows) if (groups[r.expiry_status]) groups[r.expiry_status].push(r)
  for (const s of ALERT_STATUSES) {
    groups[s].sort((a, b) => a.expires_on.localeCompare(b.expires_on) || a.product_name.localeCompare(b.product_name, 'es'))
  }
  const counts = Object.fromEntries(ALERT_STATUSES.map((s) => [s, groups[s].length])) as Record<AlertStatus, number>
  const total = ALERT_STATUSES.reduce((sum, s) => sum + counts[s], 0)
  const title = `Zahuy · Vencimientos ${formatDate(today)}`
  const subject = `${title}: ${counts.expired} vencidos, ${counts.expires_urgent} urgentes`

  const wa: string[] = [`*${title}*`]
  const text: string[] = [title, '']
  const html: string[] = [`<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`]
  for (const s of ALERT_STATUSES) {
    const list = groups[s]
    if (list.length === 0) continue
    wa.push('', `*${GROUP_TITLE[s]} (${list.length})*`)
    for (const r of list.slice(0, WHATSAPP_PER_GROUP)) wa.push(`• ${line(r)}`)
    if (list.length > WHATSAPP_PER_GROUP) wa.push(`… y ${list.length - WHATSAPP_PER_GROUP} más`)
    text.push(`${GROUP_TITLE[s]} (${list.length})`, ...list.map((r) => `- ${line(r)}`), '')
    html.push(
      `<h3 style="margin:16px 0 6px">${escapeHtml(GROUP_TITLE[s])} (${list.length})</h3>`,
      '<table cellpadding="4" style="border-collapse:collapse;font-size:14px">',
      '<tr><th align="left">Producto</th><th align="left">Lote</th><th align="right">Cantidad</th><th align="left">Vencimiento</th></tr>',
      ...list.map(
        (r) =>
          `<tr><td>${escapeHtml(r.product_name)} <small>(${escapeHtml(r.product_sku)})</small></td>` +
          `<td>${escapeHtml(r.batch_number ?? '—')}</td>` +
          `<td align="right">${escapeHtml(formatQuantity(r.quantity_available, r.sale_unit))}</td>` +
          `<td>${escapeHtml(`${formatDate(r.expires_on)} · ${whenText(r.days_to_expiry)}`)}</td></tr>`,
      ),
      '</table>',
    )
  }
  wa.push('', `Detalle: ${appUrl}`)
  text.push(`Detalle: ${appUrl}`)
  html.push(`<p style="margin-top:16px"><a href="${escapeHtml(appUrl)}">Ver las alertas en Zahuy</a></p>`)

  return { total, counts, subject, whatsapp: wa.join('\n'), html: html.join('\n'), text: text.join('\n') }
}

/** Destinatarios de WhatsApp (CallMeBot): "telefono:apikey,telefono:apikey". Ignora entradas mal formadas. */
export function parseWhatsappRecipients(raw: string | undefined): { phone: string; apikey: string }[] {
  return (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [phone = '', apikey = ''] = p.split(':')
      return { phone: phone.replace(/[^\d+]/g, ''), apikey: apikey.trim() }
    })
    .filter((r) => /^\+?\d{8,15}$/.test(r.phone) && r.apikey !== '')
}

export function parseEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
}

/** Comparación en tiempo constante del token del cron. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Fecha de hoy en Argentina, AAAA-MM-DD. */
export function todayAr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now)
}
