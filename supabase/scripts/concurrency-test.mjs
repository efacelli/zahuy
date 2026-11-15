// Prueba de concurrencia de las RPC de stock (contrato §12: "dos salidas
// concurrentes sobre el mismo lote → nunca saldo negativo").
//
// pgTAP corre en una sola sesión, así que no puede probar pedidos simultáneos.
// Este script manda pedidos en paralelo por la API, como lo haría la app.
//
// SOLO PARA LA BASE LOCAL. Crea datos ficticios y, como el ledger no se borra,
// conviene correr `npx supabase@3.1.0 db reset` al terminar.
//
// Uso, desde la raíz del repo, después de `db reset` y `npm run db:users`:
//
//   node supabase/scripts/concurrency-test.mjs
//
// Toma la configuración de los mismos archivos locales que la app (ninguno se
// sube a Git), o de variables de entorno con el mismo nombre:
//   .env.local       VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
//   .env.test.local  TEST_USER_PASSWORD
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

// Compara sin depender del orden de las claves.
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

// Catálogo ficticio propio de esta corrida.
const tag = uuid().slice(0, 8)
const first = (rows) => (Array.isArray(rows) ? rows[0] : undefined)
const category = first(await rest('categories', { method: 'POST', body: JSON.stringify({ name: `Concurrencia ${tag}` }) }))
const brand = first(await rest('brands', { method: 'POST', body: JSON.stringify({ name: `Marca concurrencia ${tag}` }) }))
if (!category?.id || !brand?.id) {
  console.error('No se pudieron crear los catálogos de prueba: el usuario tiene que ser encargado o dueño.')
  process.exit(1)
}
const base = {
  p_category_id: category.id,
  p_brand_id: brand.id,
  p_sale_unit: 'unit',
  p_cost_price: 1,
  p_sale_price: 2,
  p_vat_rate: 21,
}
const newProduct = async (name, quantity, expiresOn) =>
  (await rpc('create_product', {
    ...base,
    p_idempotency_key: uuid(),
    p_name: `${name} ${tag}`,
    p_initial_quantity: quantity,
    p_expires_on: expiresOn,
  })).body

// 1) Un lote de 10 unidades y 8 salidas simultáneas de 3, con claves distintas.
const p1 = await newProduct('Un lote', 10, '2031-01-01')
const exits = await parallel(8, () =>
  rpc('register_product_movement', { p_idempotency_key: uuid(), p_product_id: p1.id, p_movement_type: 'exit', p_quantity: 3 }),
)
check('1) lote de 10, 8 salidas simultáneas de 3', tally(exits), { OK: 3, INSUFFICIENT_STOCK: 5 })
check('1) stock final', await stockOf(p1.id), 1)

// 2) Seis anulaciones simultáneas del mismo movimiento.
const target = exits.find((r) => r.ok).body[0]
const reversals = await parallel(6, () =>
  rpc('reverse_stock_movement', { p_idempotency_key: uuid(), p_movement_id: target.id, p_reason: 'Prueba de concurrencia' }),
)
check('2) 6 anulaciones simultáneas del mismo movimiento', tally(reversals), { OK: 1, ALREADY_REVERSED: 5 })
check('2) stock final', await stockOf(p1.id), 4)

// 3) Dos lotes (4 + 4) y 12 salidas simultáneas de 1.
const p2 = await newProduct('Dos lotes', 4, '2030-06-01')
await rpc('receive_stock', { p_idempotency_key: uuid(), p_product_id: p2.id, p_quantity: 4, p_expires_on: '2030-09-01' })
const many = await parallel(12, () =>
  rpc('register_product_movement', { p_idempotency_key: uuid(), p_product_id: p2.id, p_movement_type: 'exit', p_quantity: 1 }),
)
check('3) lotes 4 + 4, 12 salidas simultáneas de 1', tally(many), { OK: 8, INSUFFICIENT_STOCK: 4 })
check('3) stock final', await stockOf(p2.id), 0)

// 4) Salidas simultáneas que reparten entre dos lotes (bloquean varios lotes cada una).
await rpc('receive_stock', { p_idempotency_key: uuid(), p_product_id: p2.id, p_quantity: 4, p_expires_on: '2030-10-01' })
await rpc('receive_stock', { p_idempotency_key: uuid(), p_product_id: p2.id, p_quantity: 4, p_expires_on: '2030-11-01' })
const split = await Promise.all(
  [6, 6, 6, 6].map((q) =>
    rpc('register_product_movement', { p_idempotency_key: uuid(), p_product_id: p2.id, p_movement_type: 'exit', p_quantity: q }),
  ),
)
check('4) lotes 4 + 4, 4 salidas simultáneas de 6', tally(split), { OK: 1, INSUFFICIENT_STOCK: 3 })
check('4) stock final', await stockOf(p2.id), 2)

// 5) La misma salida enviada 6 veces a la vez con UNA sola clave (reintentos).
const p3 = await newProduct('Reintentos', 20, '2031-01-01')
const key = uuid()
const same = await parallel(6, () =>
  rpc('register_product_movement', { p_idempotency_key: key, p_product_id: p3.id, p_movement_type: 'exit', p_quantity: 5 }),
)
check('5) misma salida ×6 con una clave', tally(same), { OK: 6 })
check('5) movimientos distintos creados', new Set(same.flatMap((r) => r.body.map((m) => m.id))).size, 1)
check('5) stock final', await stockOf(p3.id), 15)

// 6) Altas e ingresos simultáneos con una clave nueva.
const createKey = uuid()
const creations = await parallel(6, () =>
  rpc('create_product', { ...base, p_idempotency_key: createKey, p_name: `Alta repetida ${tag}`, p_initial_quantity: 5, p_expires_on: '2031-01-01' }),
)
check('6) create_product ×6 con una clave', tally(creations), { OK: 6 })
check('6) SKU distintos devueltos', new Set(creations.map((r) => r.body.sku)).size, 1)
const receiveKey = uuid()
const receipts = await parallel(6, () =>
  rpc('receive_stock', { p_idempotency_key: receiveKey, p_product_id: p3.id, p_quantity: 7, p_expires_on: '2031-06-01' }),
)
check('6) receive_stock ×6 con una clave', tally(receipts), { OK: 6 })
check('6) stock tras un solo ingreso de 7', await stockOf(p3.id), 22)

// 7) Ningún lote de estos productos quedó en negativo.
const batches = await rest(`product_batches?select=quantity_available&product_id=in.(${p1.id},${p2.id},${p3.id})`)
check('7) lotes en negativo', batches.filter((b) => Number(b.quantity_available) < 0).length, 0)

console.warn(failures === 0 ? '\nConcurrencia: todo coincide con lo esperado.' : `\nConcurrencia: ${failures} verificaciones fallaron.`)
process.exit(failures === 0 ? 0 : 1)
