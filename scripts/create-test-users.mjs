// Crea los usuarios de prueba en la Supabase LOCAL (después de `supabase db reset`).
//
//   npm run db:users
//
// - Solo funciona contra 127.0.0.1/localhost: se niega a tocar otra URL.
// - La contraseña sale de .env.test.local (TEST_USER_PASSWORD), que no se sube a Git.
// - La clave secreta local se lee de `supabase status`; no se imprime ni se guarda.
// - Si el usuario ya existe, solo se le ajusta el rol.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const USERS = [
  { email: 'encargado@zahuy.test', full_name: 'Encargado de prueba', role: 'manager' },
  { email: 'empleado@zahuy.test', full_name: 'Empleado de prueba', role: 'staff' },
  { email: 'dueno@zahuy.test', full_name: 'Dueño de prueba', role: 'admin' },
  { email: 'duena@zahuy.test', full_name: 'Dueña de prueba', role: 'admin' },
]

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    )
  } catch {
    return {}
  }
}

const password = process.env.TEST_USER_PASSWORD ?? readEnvFile('.env.test.local').TEST_USER_PASSWORD
if (!password || password.length < 8) {
  console.error('Falta TEST_USER_PASSWORD (8+ caracteres) en .env.test.local.')
  process.exit(1)
}

const status = Object.fromEntries(
  execSync('npx supabase@3.1.0 status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const url = status.API_URL
const key = status.SECRET_KEY || status.SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('No se pudo leer la Supabase local. ¿Está corriendo? (npx supabase@3.1.0 start)')
  process.exit(1)
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error(`Este script es solo para la base local; se recibió ${url}.`)
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

for (const u of USERS) {
  let id
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.full_name } }),
  })
  if (created.ok) {
    id = (await created.json()).id
  } else {
    const list = await (await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers })).json()
    id = list.users?.find((x) => x.email === u.email)?.id
    if (!id) {
      console.error(`${u.email}: no se pudo crear (${created.status}).`)
      continue
    }
  }
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ role: u.role, full_name: u.full_name, is_active: true }),
  })
  // oxlint-disable-next-line no-console -- script de terminal
  console.log(`${u.email}: ${created.ok ? 'creado' : 'ya existía'}, rol ${u.role}${res.ok ? '' : ` (perfil: error ${res.status})`}`)
}
