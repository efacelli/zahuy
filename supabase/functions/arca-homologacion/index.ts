// Edge Function de PRUEBA para ARCA en HOMOLOGACIÓN (etapa 6, solo investigación).
//
//   POST { "action": "dummy" }    -> FEDummy (estado de WSFEv1; no usa certificado)
//   POST { "action": "ultimo" }   -> WSAA (ticket de acceso) + FECompUltimoAutorizado
//
// Reglas (CLAUDE.md): nada de producción (las URL están fijas a homologación en
// arca.ts), ninguna clave en el repo (el certificado y la clave privada se leen
// de secretos de la función), y nunca se devuelven ni se registran el token, el
// sign, el certificado ni la clave. Solo puede llamarla un usuario activo con rol
// `admin` (se comprueba en la base, no en el cliente).
import {
  ArcaError,
  CBTE_TIPOS,
  callDummy,
  callUltimoAutorizado,
  requestAccessTicket,
  type TicketDeAcceso,
} from './arca.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// El ticket de acceso vale 12 horas y el WSAA rechaza pedir otro mientras haya uno
// válido (coe.alreadyAuthenticated). Se guarda en memoria de la instancia; si la
// instancia se recicla, el error se informa tal cual y se espera a que venza.
let cachedTicket: TicketDeAcceso | null = null

function ticketIsUsable(ticket: TicketDeAcceso | null): ticket is TicketDeAcceso {
  if (!ticket) return false
  const expires = Date.parse(ticket.expirationTime)
  return Number.isFinite(expires) && expires - Date.now() > 5 * 60 * 1000
}

/** Comprueba que quien llama es un administrador activo, consultando la base con su propio JWT. */
async function assertAdmin(request: Request): Promise<void> {
  const authorization = request.headers.get('Authorization') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization.startsWith('Bearer ') || !supabaseUrl || !anonKey) {
    throw new ArcaError('NOT_AUTHORIZED', 'Sin sesión')
  }
  const headers = { apikey: anonKey, Authorization: authorization }
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers })
  if (!userResponse.ok) throw new ArcaError('NOT_AUTHORIZED', 'Sesión inválida')
  const user = (await userResponse.json()) as { id?: string }
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) throw new ArcaError('NOT_AUTHORIZED', 'Sesión inválida')

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=role,is_active&id=eq.${user.id}`,
    { headers },
  )
  const rows = profileResponse.ok ? ((await profileResponse.json()) as { role: string; is_active: boolean }[]) : []
  if (rows[0]?.role !== 'admin' || rows[0]?.is_active !== true) {
    throw new ArcaError('NOT_AUTHORIZED', 'Solo el dueño puede usar esta función')
  }
}

function readConfig() {
  const cuit = Deno.env.get('ARCA_CUIT') ?? ''
  // Los secretos multilínea suelen guardarse con \n literales.
  const certPem = (Deno.env.get('ARCA_CERT_PEM') ?? '').replace(/\\n/g, '\n')
  const keyPem = (Deno.env.get('ARCA_KEY_PEM') ?? '').replace(/\\n/g, '\n')
  const missing = [
    !cuit && 'ARCA_CUIT',
    !certPem && 'ARCA_CERT_PEM',
    !keyPem && 'ARCA_KEY_PEM',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new ArcaError('NOT_CONFIGURED', `Faltan secretos de la función: ${missing.join(', ')}`)
  }
  return {
    cuit,
    certPem,
    keyPem,
    ptoVta: Number(Deno.env.get('ARCA_PTO_VTA') ?? '1'),
    cbteTipo: Number(Deno.env.get('ARCA_CBTE_TIPO') ?? '6'),
    digest: Deno.env.get('ARCA_DIGEST') === 'sha1' ? ('sha1' as const) : ('sha256' as const),
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' })

  try {
    await assertAdmin(request)
    const body = (await request.json().catch(() => ({}))) as { action?: string }
    const action = body.action ?? 'ultimo'

    if (action === 'dummy') {
      const dummy = await callDummy()
      return json(200, { ok: true, environment: 'homologacion', action, dummy })
    }
    if (action !== 'ultimo') return json(400, { ok: false, code: 'INVALID_ACTION' })

    const config = readConfig()
    if (!ticketIsUsable(cachedTicket)) {
      cachedTicket = await requestAccessTicket({
        certPem: config.certPem,
        keyPem: config.keyPem,
        digest: config.digest,
      })
    }
    const result = await callUltimoAutorizado({
      token: cachedTicket.token,
      sign: cachedTicket.sign,
      cuit: config.cuit,
      ptoVta: config.ptoVta,
      cbteTipo: config.cbteTipo,
    })
    return json(200, {
      ok: result.errors.length === 0,
      environment: 'homologacion',
      action,
      // Nunca se devuelve el token ni el sign: solo cuándo vence el ticket.
      ticket_expires_at: cachedTicket.expirationTime,
      cbte_tipo_nombre: CBTE_TIPOS[result.cbteTipo as keyof typeof CBTE_TIPOS] ?? null,
      result,
    })
  } catch (error) {
    if (error instanceof ArcaError) {
      const status = error.code === 'NOT_AUTHORIZED' ? 403 : error.code === 'NOT_CONFIGURED' ? 500 : 502
      return json(status, { ok: false, environment: 'homologacion', code: error.code, message: error.message })
    }
    console.error('arca-homologacion: error inesperado', error instanceof Error ? error.name : 'desconocido')
    return json(500, { ok: false, code: 'UNEXPECTED_ERROR' })
  }
})
