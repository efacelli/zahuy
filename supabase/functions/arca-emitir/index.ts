// Edge Function `arca-emitir`: emite una factura electrónica de UNA venta en ARCA, solo HOMOLOGACIÓN.
// Contrato §22.3. La lógica vive en emitir.ts (probada con simulaciones); este archivo solo conecta:
//   - la sesión del usuario (JWT) con la base,
//   - las funciones fiscales de la base (service_role, nunca expuestas al navegador),
//   - ARCA (módulo ../arca-homologacion/arca.ts, fijo a las URL de homologación).
//
//   POST { "sale_id": uuid, "idempotency_key": uuid, "receiver"?: { "docType", "docNumber", "vatConditionId" } }
//   -> 200 autorizado | 202 en curso (volver a llamar con la MISMA clave) | 422 rechazado | 4xx/5xx error
//
// Reglas (CLAUDE.md): nada de producción (en ambiente 'produccion' responde 501), ningún secreto en el repo
// (el certificado y la clave están en secretos de la función) y nunca se devuelven ni se registran el
// token, la firma, el certificado ni la clave.
import {
  ArcaError,
  callCaeSolicitar,
  callCompConsultar,
  callUltimoAutorizado,
  requestAccessTicket,
} from '../arca-homologacion/arca.ts'
import { emitCreditNote, emitInvoice, type EmitDeps, type FiscalDocument } from './emitir.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

/** Error devuelto por una función de la base (el mensaje es el código de negocio: SALE_NOT_FOUND, etc.). */
class RpcError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'RpcError'
    this.code = code
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new ArcaError('NOT_CONFIGURED', `Falta ${name} en la función`)
  return value
}

/** Usuario activo, con su propia sesión, que además puede ver la venta (la RLS decide). */
async function authenticate(request: Request, saleId: string): Promise<string> {
  const authorization = request.headers.get('Authorization') ?? ''
  const url = env('SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY')
  if (!authorization.startsWith('Bearer ')) throw new ArcaError('NOT_AUTHENTICATED', 'Sin sesión')
  const headers = { apikey: anonKey, Authorization: authorization }
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers })
  if (!userResponse.ok) throw new ArcaError('NOT_AUTHENTICATED', 'Sesión inválida')
  const user = (await userResponse.json()) as { id?: string }
  if (!user.id || !UUID.test(user.id)) throw new ArcaError('NOT_AUTHENTICATED', 'Sesión inválida')

  const profile = await fetch(`${url}/rest/v1/profiles?select=is_active&id=eq.${user.id}`, { headers })
  const rows = profile.ok ? ((await profile.json()) as { is_active: boolean }[]) : []
  if (rows[0]?.is_active !== true) throw new ArcaError('NOT_AUTHORIZED', 'Usuario inactivo')

  // Solo puede facturar una venta que su rol puede ver.
  const sale = await fetch(`${url}/rest/v1/sales?select=id&id=eq.${saleId}`, { headers })
  const sales = sale.ok ? ((await sale.json()) as unknown[]) : []
  if (sales.length !== 1) throw new ArcaError('NOT_AUTHORIZED', 'No puede facturar esta venta')
  return user.id
}

function makeDeps(): EmitDeps {
  const url = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const cuit = env('ARCA_CUIT')
  // Los secretos multilínea suelen guardarse con \n literales.
  const certPem = env('ARCA_CERT_PEM').replace(/\\n/g, '\n')
  const keyPem = env('ARCA_KEY_PEM').replace(/\\n/g, '\n')
  const digest = Deno.env.get('ARCA_DIGEST') === 'sha1' ? ('sha1' as const) : ('sha256' as const)
  const service = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }

  return {
    settings: async () => {
      const response = await fetch(`${url}/rest/v1/fiscal_settings?select=environment,pto_vta`, { headers: service })
      const rows = response.ok ? ((await response.json()) as { environment: string; pto_vta: number | null }[]) : []
      if (!rows[0]) throw new ArcaError('NOT_CONFIGURED', 'No hay configuración fiscal')
      return rows[0]
    },
    chargedAmount: async (saleId) => {
      const response = await fetch(`${url}/rest/v1/sales?select=total_amount,rounding_amount&id=eq.${saleId}`, { headers: service })
      const rows = response.ok ? ((await response.json()) as { total_amount: number; rounding_amount: number }[]) : []
      if (!rows[0]) throw new RpcError('SALE_NOT_FOUND')
      return Number(rows[0].total_amount) + Number(rows[0].rounding_amount)
    },
    findInvoice: async (saleId) => {
      const response = await fetch(
        `${url}/rest/v1/fiscal_documents?select=*&sale_id=eq.${saleId}&kind=eq.invoice&status=eq.authorized&limit=1`,
        { headers: service },
      )
      const rows = response.ok ? ((await response.json()) as FiscalDocument[]) : []
      return rows[0] ?? null
    },
    rpc: (async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: service, body: JSON.stringify(args) })
      const text = await response.text()
      if (!response.ok) {
        let code = 'RPC_ERROR'
        try {
          code = String((JSON.parse(text) as { message?: string }).message ?? code)
        } catch { /* cuerpo no JSON */ }
        throw new RpcError(code)
      }
      return text === '' ? null : JSON.parse(text)
    }) as EmitDeps['rpc'],
    arca: {
      login: () => requestAccessTicket({ certPem, keyPem, digest }),
      ultimo: (ticket, ptoVta, cbteTipo) => callUltimoAutorizado({ token: ticket.token, sign: ticket.sign, cuit, ptoVta, cbteTipo }),
      solicitar: (ticket, args) => callCaeSolicitar({ token: ticket.token, sign: ticket.sign, cuit, ...args }),
      consultar: (ticket, ptoVta, cbteTipo, cbteNro) =>
        callCompConsultar({ token: ticket.token, sign: ticket.sign, cuit, ptoVta, cbteTipo, cbteNro }),
    },
    now: () => new Date(),
  }
}

const ARCA_STATUS: Record<string, number> = {
  NOT_AUTHENTICATED: 401,
  NOT_AUTHORIZED: 403,
  FISCAL_DISABLED: 409,
  PRODUCTION_NOT_IMPLEMENTED: 501,
  NOT_CONFIGURED: 500,
  INVALID_RECEIVER: 400,
  IDENTIFICATION_REQUIRED: 400,
  INVALID_REQUEST: 400,
  NO_INVOICE: 409,
  TICKET_UNAVAILABLE: 503,
}
const RPC_STATUS: Record<string, number> = {
  SALE_NOT_FOUND: 404,
  SALE_VOIDED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FISCAL_UNSUPPORTED_VAT: 422,
  FISCAL_DISABLED: 409,
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' })

  try {
    const body = (await request.json().catch(() => null)) as {
      /** `invoice` (por defecto) o `credit_note` (anula la factura autorizada de la venta). */
      action?: string
      sale_id?: string
      idempotency_key?: string
      receiver?: { docType?: number; docNumber?: string; vatConditionId?: number }
    } | null
    if (!body || !UUID.test(body.sale_id ?? '') || !UUID.test(body.idempotency_key ?? '')) {
      throw new ArcaError('INVALID_REQUEST', 'Faltan sale_id e idempotency_key (uuid)')
    }
    const action = body.action ?? 'invoice'
    if (action !== 'invoice' && action !== 'credit_note') throw new ArcaError('INVALID_REQUEST', 'action debe ser invoice o credit_note')
    const userId = await authenticate(request, body.sale_id!)
    const input = { saleId: body.sale_id!, idempotencyKey: body.idempotency_key!, createdBy: userId }
    const result =
      action === 'credit_note'
        ? await emitCreditNote(makeDeps(), input)
        : await emitInvoice(makeDeps(), { ...input, receiver: body.receiver })
    const status = result.status === 'authorized' ? 200 : result.inProgress ? 202 : 422
    return json(status, { ok: result.status === 'authorized', environment: 'homologacion', ...result })
  } catch (error) {
    if (error instanceof ArcaError) {
      return json(ARCA_STATUS[error.code] ?? 502, { ok: false, environment: 'homologacion', code: error.code, message: error.message })
    }
    if (error instanceof RpcError) {
      return json(RPC_STATUS[error.code] ?? 500, { ok: false, environment: 'homologacion', code: error.code })
    }
    // Nunca se imprime el mensaje (podría traer datos): solo el tipo de error.
    console.error('arca-emitir: error inesperado', error instanceof Error ? error.name : 'desconocido')
    return json(500, { ok: false, code: 'INTERNAL_ERROR' })
  }
})
