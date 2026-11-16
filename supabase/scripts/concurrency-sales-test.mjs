// Prueba de concurrencia de ventas y caja (contrato v0.6.1 §15.10).
//
// pgTAP corre en una sola sesión, así que no puede probar pedidos simultáneos.
// Este script manda pedidos en paralelo por la API, como lo haría la caja:
//   * ventas simultáneas sobre el mismo lote: nunca stock negativo;
//   * la misma venta reenviada a la vez con una clave: una sola venta;
//   * ventas y cierre de caja a la vez: el arqueo cuenta exactamente las ventas
//     que entraron y ninguna se cuela después del cierre;
//   * anulaciones simultáneas de la misma venta: una sola devuelve stock;
//   * ventas con los mismos productos en orden opuesto: sin bloqueos cruzados.
//
// SOLO PARA LA BASE LOCAL. Crea datos ficticios y, como el ledger no se borra,
// conviene correr `npx supabase@3.1.0 db reset` al terminar.
//
// Uso, desde la raíz del repo, después de `db reset` y `npm run db:users`:
//
//   node supabase/scripts/concurrency-sales-test.mjs
//
// Misma configuración que concurrency-test.mjs (.env.local y .env.test.local).
// Usuario: encargado@zahuy.test (se puede cambiar con TEST_EMAIL).
//
// Termina con código 0 si todo coincide con lo esperado, 1 si algo falla.
import { readFileSync } from 'node:fs'

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    )
  } catch {
    return {}
  }
}

const env = { ...readEnvFile('.env.local'), ...readEnvFile('.env.test.local'), ...process.env }
const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '')
const SUPABASE_PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY
const TEST_EMAIL = env.TEST_EMAIL ?? 'encargado@zahuy.test'
const TEST_PASSWORD = env.TEST_USER_PASSWORD

if (!SUPABASE_PUBLISHABLE_KEY || !TEST_PASSWORD) {
  console.error('Falta VITE_SUPABASE_PUBLISHABLE_KEY (.env.local) o TEST_USER_PASSWORD (.env.test.local).')
  process.exit(1)
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SUPABASE_URL)) {
  console.error('Este script solo corre contra Supabase local (127.0.0.1 o localhost).')
  process.exit(1)
}

const uuid = () => crypto.randomUUID()
let failures = 0

const canonical = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? JSON.stringify(Object.keys(value).sort().map((k) => [k, value[k]]))
    : JSON.stringify(value)

function check(name, actual, expected) {
  const ok = canonical(actual) === canonical(expected)
  if (!ok) failures += 1
  console.warn(`${ok ? 'ok   ' : 'FALLA'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (esperado ${JSON.stringify(expected)})`}`)
}

const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
})
const session = await login.json()
if (!session.access_token) {
  console.error('No se pudo iniciar sesión como ' + TEST_EMAIL + '. Antes hay que correr: npm run db:users')
  process.exit(1)
}

const headers = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${session.access_token}`,
  'Content-Type': 'application/json',
}

async function rpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(params) })
  const body = await res.json()
  return res.ok ? { ok: true, body } : { ok: false, code: body.message ?? body.code }
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...headers, Prefer: 'return=representation' }, ...init })
  return res.json()
}

function tally(results) {
  const counts = {}
  for (const r of results) {
    const key = r.ok ? 'OK' : r.code
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

const stockOf = async (id) => Number((await rest(`v_product_list?select=stock_quantity&id=eq.${id}`))[0].stock_quantity)
const parallel = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)))
const first = (rows) => (Array.isArray(rows) ? rows[0] : undefined)

// Catálogo y medios de pago.
const tag = uuid().slice(0, 8)
const category = first(await rest('categories', { method: 'POST', body: JSON.stringify({ name: `Concurrencia ventas ${tag}` }) }))
const brand = first(await rest('brands', { method: 'POST', body: JSON.stringify({ name: `Marca ventas ${tag}` }) }))
if (!category?.id || !brand?.id) {
  console.error('No se pudieron crear los catálogos de prueba: el usuario tiene que ser encargado o dueño.')
  process.exit(1)
}
const methods = Object.fromEntries((await rest('payment_methods?select=id,code')).map((m) => [m.code, m.id]))
if (!methods.cash || !methods.debit) {
  console.error('No hay medios de pago: faltan las migraciones de ventas (db reset).')
  process.exit(1)
}

// Productos de 1.210 con IVA (1.000 sin IVA + 21 %).
const newProduct = async (name, quantity, expiresOn = '2031-01-01') =>
  (await rpc('create_product', {
    p_idempotency_key: uuid(),
    p_name: `${name} ${tag}`,
    p_category_id: category.id,
    p_brand_id: brand.id,
    p_sale_unit: 'unit',
    p_cost_price: 100,
    p_sale_price: 1000,
    p_vat_rate: 21,
    p_initial_quantity: quantity,
    p_expires_on: expiresOn,
  })).body

const item = (product, quantity) => ({ product_id: product.id, quantity })
const debit = (amount) => ({ payment_method_id: methods.debit, amount, tendered_amount: null, reference: null })
const cash = (amount) => ({ payment_method_id: methods.cash, amount, tendered_amount: null, reference: null })
const sell = (sessionId, items, payments, key = uuid()) =>
  rpc('register_sale', { p_idempotency_key: key, p_cash_session_id: sessionId, p_items: items, p_payments: payments, p_notes: null })

// Una caja con sesión abierta nueva (se cierra la que haya quedado de otra corrida).
const registers = await rest('cash_registers?select=id,name&is_active=eq.true&order=name')
const openNew = async (opening = 0) => {
  for (const reg of registers) {
    const r = await rpc('open_cash_session', { p_idempotency_key: uuid(), p_cash_register_id: reg.id, p_opening_amount: opening })
    if (r.ok) return r.body
  }
  // Todas las cajas tienen sesión abierta de otra corrida: se cierra la primera y se abre de nuevo.
  const open = await rest('v_cash_session_summary?select=cash_session_id&status=eq.open')
  await rpc('close_cash_session', { p_cash_session_id: open[0].cash_session_id, p_counted_cash: 0, p_close_notes: 'Prueba' })
  return openNew(opening)
}
const sessionA = await openNew(1000)

// 1) Un lote de 10 u. y 8 ventas simultáneas de 3 u. (pago exacto con débito).
const p1 = await newProduct('Venta un lote', 10)
const sales1 = await parallel(8, () => sell(sessionA.id, [item(p1, 3)], [debit(3630)]))
check('1) lote de 10, 8 ventas simultáneas de 3', tally(sales1), { OK: 3, INSUFFICIENT_STOCK: 5 })
check('1) stock final', await stockOf(p1.id), 1)
check('1) ventas creadas', (await rest(`sale_items?select=id&product_id=eq.${p1.id}`)).length, 3)

// 2) La misma venta enviada 6 veces a la vez con UNA clave.
const p2 = await newProduct('Venta reintentos', 20)
const key = uuid()
const same = await parallel(6, () => sell(sessionA.id, [item(p2, 5)], [debit(6050)], key))
check('2) misma venta ×6 con una clave', tally(same), { OK: 6 })
check('2) ventas distintas creadas', new Set(same.map((r) => r.body.id)).size, 1)
check('2) stock final (se descontó una sola vez)', await stockOf(p2.id), 15)

// 3) Anulaciones simultáneas de la misma venta (claves distintas).
const target = same[0].body
const voids = await parallel(6, () => rpc('void_sale', { p_idempotency_key: uuid(), p_sale_id: target.id, p_reason: 'Prueba de concurrencia' }))
check('3) 6 anulaciones simultáneas de la misma venta', tally(voids), { OK: 1, ALREADY_VOIDED: 5 })
check('3) stock final (se devolvió una sola vez)', await stockOf(p2.id), 20)

// 4) Venta y cierre de caja a la vez: el arqueo cuenta exactamente las ventas que entraron.
const sessionB = await openNew(500)
const p3 = await newProduct('Venta y cierre', 100)
// Las ventas salen primero y el cierre llega en medio: parte entra y parte se rechaza.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const [closeResult, ...salesDuringClose] = await Promise.all([
  pause(40).then(() => rpc('close_cash_session', { p_cash_session_id: sessionB.id, p_counted_cash: 0, p_close_notes: 'Cierre simultáneo' })),
  ...Array.from({ length: 60 }, (_, i) => pause(i * 3).then(() => sell(sessionB.id, [item(p3, 1)], [cash(1200)]))),
])
const okSales = salesDuringClose.filter((r) => r.ok).length
const rejected = salesDuringClose.filter((r) => !r.ok)
console.warn(`     (en la carrera entraron ${okSales} ventas y se rechazaron ${rejected.length})`)
check('4) el cierre se hizo', closeResult.ok, true)
check('4) toda venta fue aceptada o rechazada por caja cerrada', rejected.every((r) => r.code === 'CASH_SESSION_CLOSED'), true)
const closed = first(await rest(`cash_sessions?select=expected_cash,closed_at&id=eq.${sessionB.id}`))
check('4) el esperado cuenta exactamente las ventas aceptadas (500 + 1.200 cada una)', Number(closed.expected_cash), 500 + 1200 * okSales)
// created_at es el inicio de la transacción, no el momento de confirmarla; por eso la prueba
// compara el arqueo guardado con lo que de verdad quedó en la sesión: si una venta se hubiera
// colado después de calcular el esperado, la suma final sería mayor.
const salesInB = await rest(`sales?select=id&cash_session_id=eq.${sessionB.id}`)
check('4) cantidad de ventas guardadas = aceptadas', salesInB.length, okSales)
const cashInB = await rest(`sale_payments?select=amount,sales!inner(cash_session_id)&sales.cash_session_id=eq.${sessionB.id}&payment_method_id=eq.${methods.cash}`)
check('4) el efectivo guardado en la sesión coincide con el esperado del cierre', 500 + cashInB.reduce((s, p) => s + Number(p.amount), 0), Number(closed.expected_cash))
check('4) stock descontado = ventas aceptadas', await stockOf(p3.id), 100 - okSales)

// 5) Ventas con los mismos productos en orden opuesto: sin bloqueos cruzados.
const sessionC = await openNew(0).catch(() => null)
const sessionForC = sessionC ?? sessionA
const pa = await newProduct('Orden A', 200)
const pb = await newProduct('Orden B', 200)
const crossed = await parallel(30, (i) =>
  sell(sessionForC.id, i % 2 === 0 ? [item(pa, 1), item(pb, 1)] : [item(pb, 1), item(pa, 1)], [debit(2420)]),
)
check('5) 30 ventas con productos en orden opuesto', tally(crossed), { OK: 30 })
check('5) stock A', await stockOf(pa.id), 170)
check('5) stock B', await stockOf(pb.id), 170)

// 6) Conciliación: ningún lote negativo y el saldo coincide con el ledger.
const ids = [p1, p2, p3, pa, pb].map((p) => p.id).join(',')
const batches = await rest(`product_batches?select=id,quantity_available&product_id=in.(${ids})`)
check('6) lotes en negativo', batches.filter((b) => Number(b.quantity_available) < 0).length, 0)
const movements = await rest(`stock_movements?select=batch_id,signed_quantity&product_id=in.(${ids})`)
const ledger = new Map()
for (const m of movements) ledger.set(m.batch_id, (ledger.get(m.batch_id) ?? 0) + Number(m.signed_quantity))
check('6) lotes cuyo saldo no coincide con el ledger', batches.filter((b) => Math.abs((ledger.get(b.id) ?? 0) - Number(b.quantity_available)) > 1e-9).length, 0)

// Se cierran las sesiones que dejó la prueba.
for (const s of [sessionA, sessionC].filter(Boolean)) {
  await rpc('close_cash_session', { p_cash_session_id: s.id, p_counted_cash: 0, p_close_notes: 'Fin de la prueba' })
}

console.warn(failures === 0 ? '\nConcurrencia de ventas: todo coincide con lo esperado.' : `\nConcurrencia de ventas: ${failures} verificaciones fallaron.`)
process.exit(failures === 0 ? 0 : 1)
