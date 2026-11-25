import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { buildDigest, escapeHtml, parseEmails, parseWhatsappRecipients, safeEqual, todayAr, whenText, type BatchRow } from './digest.ts'

const row = (over: Partial<BatchRow>): BatchRow => ({
  product_name: 'Yogur frutilla',
  product_sku: '000001',
  batch_number: null,
  expires_on: '2026-11-30',
  days_to_expiry: 5,
  expiry_status: 'expires_urgent',
  quantity_available: '4.000',
  sale_unit: 'unit',
  category_name: 'Lácteos',
  ...over,
})

Deno.test('agrupa por estado, cuenta y ordena por vencimiento', () => {
  const d = buildDigest(
    [
      row({ product_name: 'B', expires_on: '2026-11-28', days_to_expiry: 3 }),
      row({ product_name: 'A', expires_on: '2026-11-20', days_to_expiry: -5, expiry_status: 'expired', batch_number: 'L1' }),
      row({ product_name: 'C', expires_on: '2026-11-27', days_to_expiry: 2 }),
      row({ product_name: 'Queso', expires_on: '2026-12-20', days_to_expiry: 25, expiry_status: 'expires_upcoming', quantity_available: '1.250', sale_unit: 'kg' }),
    ],
    '2026-11-25',
    'https://ejemplo.test/alertas',
  )
  assertEquals(d.total, 4)
  assertEquals(d.counts, { expired: 1, expires_urgent: 2, expires_soon: 0, expires_upcoming: 1 })
  assertEquals(d.subject, 'Zahuy · Vencimientos 25/11/2026: 1 vencidos, 2 urgentes')
  assertStringIncludes(d.whatsapp, '*Vencidos con stock (1)*\n• A (lote L1) — 4 u — venció hace 5 días (20/11/2026)')
  assert(d.whatsapp.indexOf('• C ') < d.whatsapp.indexOf('• B '), 'el que vence antes va primero')
  assertStringIncludes(d.whatsapp, 'Queso — 1,25 kg — vence en 25 días')
  assert(!d.whatsapp.includes('Vencen pronto'), 'los grupos vacíos no aparecen')
  assertStringIncludes(d.whatsapp, 'Detalle: https://ejemplo.test/alertas')
})

Deno.test('el WhatsApp corta cada grupo en 8 y el email trae todo', () => {
  const rows = Array.from({ length: 11 }, (_, i) => row({ product_name: `P${String(i).padStart(2, '0')}` }))
  const d = buildDigest(rows, '2026-11-25', 'https://ejemplo.test')
  assertStringIncludes(d.whatsapp, '… y 3 más')
  assertEquals((d.html.match(/<tr><td>/g) ?? []).length, 11)
  assertEquals((d.text.match(/^- /gm) ?? []).length, 11)
})

Deno.test('sin alertas, el total es 0', () => {
  assertEquals(buildDigest([], '2026-11-25', 'x').total, 0)
})

Deno.test('el email escapa el HTML de los nombres', () => {
  const d = buildDigest([row({ product_name: '<b>Jamón & queso</b>' })], '2026-11-25', 'x')
  assertStringIncludes(d.html, '&lt;b&gt;Jamón &amp; queso&lt;/b&gt;')
  assertEquals(escapeHtml('"'), '&quot;')
})

Deno.test('textos de cuándo vence', () => {
  assertEquals(whenText(-1), 'venció ayer')
  assertEquals(whenText(0), 'vence hoy')
  assertEquals(whenText(1), 'vence mañana')
})

Deno.test('destinatarios de WhatsApp y email', () => {
  assertEquals(parseWhatsappRecipients(' +54 9 385 000-0000:abc , malo, 123:x, +5493850000001: '), [
    { phone: '+5493850000000', apikey: 'abc' },
  ])
  assertEquals(parseWhatsappRecipients(undefined), [])
  assertEquals(parseEmails('a@b.com, no-es-mail ,c@d.com.ar'), ['a@b.com', 'c@d.com.ar'])
})

Deno.test('token del cron', () => {
  assert(safeEqual('abc', 'abc'))
  assert(!safeEqual('abc', 'abd'))
  assert(!safeEqual('', ''), 'sin token configurado no entra nadie')
})

Deno.test('fecha de Argentina', () => {
  // 02:00 UTC del 26 son las 23:00 del 25 en Argentina.
  assertEquals(todayAr(new Date('2026-11-26T02:00:00Z')), '2026-11-25')
})
