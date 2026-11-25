// Edge Function `daily-alerts`: resumen diario de vencimientos al encargado por WhatsApp (CallMeBot) y email (Resend).
//
// La llama un cron (GitHub Actions, 8:00 de Argentina) con el encabezado `x-alerts-token`. No usa la sesión de
// ningún usuario: lee `v_batch_status` con la clave de servicio, que solo existe dentro de Supabase.
//
// Secretos de la función (ninguno va al repositorio):
//   ALERTS_CRON_TOKEN    token compartido con el cron (obligatorio).
//   ALERTS_WHATSAPP      "telefono:apikey,..." de CallMeBot (cada destinatario activa el suyo).
//   RESEND_API_KEY       clave de Resend.
//   ALERTS_EMAIL_TO      "mail1,mail2".
//   ALERTS_EMAIL_FROM    remitente (por defecto "Zahuy <onboarding@resend.dev>").
//   ALERTS_APP_URL       enlace a la pantalla de Alertas (por defecto https://zahuy.onrender.com/alertas).
// Cuerpo opcional: {"dryRun": true} arma el resumen y lo devuelve sin mandar nada.

import { ALERT_STATUSES, buildDigest, parseEmails, parseWhatsappRecipients, safeEqual, todayAr, type BatchRow } from './digest.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function fetchAlertRows(): Promise<BatchRow[]> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('NOT_CONFIGURED')
  const params = new URLSearchParams({
    select: 'product_name,product_sku,batch_number,expires_on,days_to_expiry,expiry_status,quantity_available,sale_unit,category_name',
    expiry_status: `in.(${ALERT_STATUSES.join(',')})`,
    order: 'expires_on.asc,product_name.asc',
    limit: '2000',
  })
  const res = await fetch(`${url}/rest/v1/v_batch_status?${params}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`READ_FAILED_${res.status}`)
  return (await res.json()) as BatchRow[]
}

async function sendWhatsapp(phone: string, apikey: string, text: string): Promise<boolean> {
  const params = new URLSearchParams({ phone, text, apikey })
  const res = await fetch(`https://api.callmebot.com/whatsapp.php?${params}`)
  await res.body?.cancel()
  return res.ok
}

async function sendEmail(to: string[], subject: string, html: string, text: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key || to.length === 0) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('ALERTS_EMAIL_FROM') || 'Zahuy <onboarding@resend.dev>', to, subject, html, text }),
  })
  await res.body?.cancel()
  return res.ok
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
  const token = Deno.env.get('ALERTS_CRON_TOKEN') ?? ''
  if (!safeEqual(request.headers.get('x-alerts-token') ?? '', token)) return json(401, { ok: false, code: 'NOT_AUTHORIZED' })

  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean }
  let rows: BatchRow[]
  try {
    rows = await fetchAlertRows()
  } catch (error) {
    return json(502, { ok: false, code: error instanceof Error ? error.message : 'READ_FAILED' })
  }

  const digest = buildDigest(rows, todayAr(), Deno.env.get('ALERTS_APP_URL') || 'https://zahuy.onrender.com/alertas')
  if (body.dryRun) return json(200, { ok: true, dryRun: true, total: digest.total, counts: digest.counts, whatsapp: digest.whatsapp })
  // Sin nada para revisar no se manda ningún mensaje.
  if (digest.total === 0) return json(200, { ok: true, total: 0, whatsapp: 0, email: false })

  // Los resultados no incluyen teléfonos ni mails: solo cuántos salieron.
  const recipients = parseWhatsappRecipients(Deno.env.get('ALERTS_WHATSAPP'))
  let whatsappSent = 0
  for (const r of recipients) {
    if (await sendWhatsapp(r.phone, r.apikey, digest.whatsapp).catch(() => false)) whatsappSent++
  }
  const emailSent = await sendEmail(parseEmails(Deno.env.get('ALERTS_EMAIL_TO')), digest.subject, digest.html, digest.text).catch(
    () => false,
  )
  const ok = whatsappSent === recipients.length && (emailSent || !Deno.env.get('RESEND_API_KEY'))
  return json(ok ? 200 : 207, {
    ok,
    total: digest.total,
    counts: digest.counts,
    whatsapp: whatsappSent,
    whatsappRecipients: recipients.length,
    email: emailSent,
  })
})
