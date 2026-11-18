// Emisión de un comprobante electrónico en ARCA (HOMOLOGACIÓN), contrato §22.3.
//
// Esta lógica NO usa Deno ni lee variables de entorno: recibe sus dependencias, así se prueba con Node y
// con simulaciones (emitir_test.ts). index.ts la conecta con la base de datos y con ARCA de verdad.
//
// Reglas que garantiza:
//  - Solo homologación. En 'produccion' se rechaza (PRODUCTION_NOT_IMPLEMENTED) y con 'off' también.
//  - Una venta, un comprobante vivo: fiscal_begin es idempotente y fiscal_claim deja pasar a UNA sola
//    llamada a enviar a ARCA.
//  - Si ARCA no responde, el documento queda 'unknown' y NO se reenvía: se concilia consultando a ARCA
//    (FECompConsultar) pasado un tiempo prudente. Un rechazo solo se registra si ARCA lo dijo o si
//    ARCA confirmó que ese número no existe.
//  - Nunca se guarda ni se devuelve el token, la firma, el certificado ni la clave.
import {
  ARCA_COMPROBANTE_NO_EXISTE,
  ArcaError,
  formatArDateTime,
  type CaeSolicitarResult,
  type CompConsultarResult,
  type TicketDeAcceso,
  type UltimoAutorizado,
} from '../arca-homologacion/arca.ts'

/** Condiciones de IVA del receptor para las que ARCA acepta Factura A (FEParamGetCondicionIvaReceptor, clase A). */
export const CONDICIONES_FACTURA_A = [1, 6, 13, 16] as const
/** Desde este importe hay que identificar al consumidor final (P-72, confirmado). */
export const UMBRAL_IDENTIFICACION = 10_000_000
/** Si un documento enviado no tiene respuesta hace menos de esto, se lo considera "en vuelo" y no se concilia. */
export const SEGUNDOS_EN_VUELO = 120

export const DOC_TIPO = { CUIT: 80, DNI: 96, SIN_IDENTIFICAR: 99 } as const

export type IvaItem = { id: number; rate: number; base: number; amount: number }

export type FiscalDocument = {
  id: string
  sale_id: string
  kind: string
  cbte_tipo: number
  pto_vta: number
  cbte_nro: number | string
  environment: string
  status: 'pending' | 'authorized' | 'rejected' | 'unknown'
  cae: string | null
  cae_expires_on: string | null
  receiver_doc_type: number
  receiver_doc_number: string
  receiver_vat_condition_id: number
  imp_total: number | string
  imp_neto: number | string
  imp_iva: number | string
  iva_breakdown: IvaItem[]
  observations: unknown
  created_at: string
  sent_at: string | null
  authorized_at: string | null
}

export type Receiver = { docType: number; docNumber: string; vatConditionId: number }

export interface EmitDeps {
  settings(): Promise<{ environment: string; pto_vta: number | null }>
  /** Importe cobrado de la venta (total + redondeo): para exigir identificación desde el umbral. */
  chargedAmount(saleId: string): Promise<number>
  /** La factura autorizada de la venta (para emitir su nota de crédito), o null si no la tiene. */
  findInvoice(saleId: string): Promise<FiscalDocument | null>
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>
  arca: {
    login(): Promise<TicketDeAcceso>
    ultimo(ticket: TicketDeAcceso, ptoVta: number, cbteTipo: number): Promise<UltimoAutorizado>
    solicitar(ticket: TicketDeAcceso, args: SolicitarArgs): Promise<CaeSolicitarResult>
    consultar(ticket: TicketDeAcceso, ptoVta: number, cbteTipo: number, cbteNro: number): Promise<CompConsultarResult>
  }
  now(): Date
}

export type SolicitarArgs = {
  ptoVta: number
  cbteTipo: number
  cbteNro: number
  cbteFecha: string
  docTipo: number
  docNro: number
  receiverVatConditionId: number
  impTotal: number
  impNeto: number
  impIva: number
  iva: { id: number; baseImp: number; importe: number }[]
  cbtesAsoc?: { tipo: number; ptoVta: number; nro: number }[]
}

export type EmitInput = {
  saleId: string
  idempotencyKey: string
  createdBy: string
  receiver?: { docType?: number; docNumber?: string; vatConditionId?: number }
}

/** Lo que se devuelve al cliente: nunca incluye cuerpos de solicitud/respuesta ni secretos. */
export type EmitResult = {
  status: FiscalDocument['status']
  /** true = hay un envío en curso o reciente: volver a llamar con la misma clave en unos segundos. */
  inProgress: boolean
  document: {
    id: string
    kind: string
    cbte_tipo: number
    pto_vta: number
    cbte_nro: number
    environment: string
    cae: string | null
    cae_expires_on: string | null
    imp_total: number
    imp_neto: number
    imp_iva: number
    iva_breakdown: IvaItem[]
    receiver_doc_type: number
    receiver_doc_number: string
    receiver_vat_condition_id: number
    authorized_at: string | null
  }
  observations: unknown
  /** Presente cuando hay que intervenir a mano (importes distintos entre Zahuy y ARCA, por ejemplo). */
  reconcile?: string
}

// ---------------------------------------------------------------------------
// Receptor y tipo de comprobante
// ---------------------------------------------------------------------------

/** A para responsables inscriptos y monotributo (según ARCA); B para el resto. Valida el documento. */
export function resolveReceiver(input: EmitInput['receiver']): { receiver: Receiver; cbteTipo: 1 | 6 } {
  const vatConditionId = input?.vatConditionId ?? 5
  const docType = input?.docType ?? DOC_TIPO.SIN_IDENTIFICAR
  const docNumber = (input?.docNumber ?? '0').trim()
  if (!Number.isInteger(vatConditionId) || vatConditionId < 1) {
    throw new ArcaError('INVALID_RECEIVER', 'Condición frente al IVA del receptor inválida')
  }
  if (docType === DOC_TIPO.CUIT) {
    if (!/^\d{11}$/.test(docNumber)) throw new ArcaError('INVALID_RECEIVER', 'El CUIT del receptor debe tener 11 dígitos')
  } else if (docType === DOC_TIPO.DNI) {
    if (!/^\d{7,8}$/.test(docNumber)) throw new ArcaError('INVALID_RECEIVER', 'El DNI del receptor debe tener 7 u 8 dígitos')
  } else if (docType === DOC_TIPO.SIN_IDENTIFICAR) {
    if (docNumber !== '0') throw new ArcaError('INVALID_RECEIVER', 'Sin identificar lleva documento 0')
  } else {
    throw new ArcaError('INVALID_RECEIVER', 'Tipo de documento del receptor no soportado')
  }
  const isA = (CONDICIONES_FACTURA_A as readonly number[]).includes(vatConditionId)
  if (isA && docType !== DOC_TIPO.CUIT) {
    throw new ArcaError('INVALID_RECEIVER', 'La Factura A exige el CUIT del receptor')
  }
  return { receiver: { docType, docNumber, vatConditionId }, cbteTipo: isA ? 1 : 6 }
}

// ---------------------------------------------------------------------------
// Ticket de acceso (WSAA), guardado en la base
// ---------------------------------------------------------------------------

async function getTicket(deps: EmitDeps, environment: string): Promise<TicketDeAcceso> {
  const rows = await deps.rpc<{ token: string; sign: string; expiration_time: string }[]>('fiscal_ticket_get', {
    p_environment: environment,
    p_service: 'wsfe',
  })
  const row = rows?.[0]
  if (row) return { token: row.token, sign: row.sign, generationTime: '', expirationTime: row.expiration_time }
  let ticket: TicketDeAcceso
  try {
    ticket = await deps.arca.login()
  } catch (error) {
    // ARCA no entrega otro ticket mientras el anterior siga vigente: si no está guardado, hay que esperar al vencimiento.
    if (error instanceof ArcaError && error.code === 'coe.alreadyAuthenticated') {
      throw new ArcaError('TICKET_UNAVAILABLE', 'ARCA ya entregó un ticket que no está guardado: hay que esperar a que venza (hasta 12 h)')
    }
    throw error
  }
  await deps.rpc('fiscal_ticket_save', {
    p_environment: environment,
    p_service: 'wsfe',
    p_token: ticket.token,
    p_sign: ticket.sign,
    p_generation_time: ticket.generationTime,
    p_expiration_time: ticket.expirationTime,
  })
  return ticket
}

// ---------------------------------------------------------------------------
// Armado del resultado
// ---------------------------------------------------------------------------

function toResult(doc: FiscalDocument, inProgress: boolean, extra: { reconcile?: string } = {}): EmitResult {
  return {
    status: doc.status,
    inProgress,
    document: {
      id: doc.id,
      kind: doc.kind,
      cbte_tipo: Number(doc.cbte_tipo),
      pto_vta: Number(doc.pto_vta),
      cbte_nro: Number(doc.cbte_nro),
      environment: doc.environment,
      cae: doc.cae,
      cae_expires_on: doc.cae_expires_on,
      imp_total: Number(doc.imp_total),
      imp_neto: Number(doc.imp_neto),
      imp_iva: Number(doc.imp_iva),
      iva_breakdown: doc.iva_breakdown,
      receiver_doc_type: Number(doc.receiver_doc_type),
      receiver_doc_number: doc.receiver_doc_number,
      receiver_vat_condition_id: Number(doc.receiver_vat_condition_id),
      authorized_at: doc.authorized_at,
    },
    observations: doc.observations ?? [],
    ...(extra.reconcile ? { reconcile: extra.reconcile } : {}),
  }
}

/** AAAAMMDD -> AAAA-MM-DD */
const isoDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

type Asoc = { tipo: number; ptoVta: number; nro: number }[]

function solicitarArgsFor(doc: FiscalDocument, now: Date, asoc?: Asoc): SolicitarArgs {
  return {
    ...(asoc ? { cbtesAsoc: asoc } : {}),
    ptoVta: Number(doc.pto_vta),
    cbteTipo: Number(doc.cbte_tipo),
    cbteNro: Number(doc.cbte_nro),
    cbteFecha: formatArDateTime(now).slice(0, 10).replace(/-/g, ''),
    docTipo: Number(doc.receiver_doc_type),
    docNro: Number(doc.receiver_doc_number),
    receiverVatConditionId: Number(doc.receiver_vat_condition_id),
    impTotal: Number(doc.imp_total),
    impNeto: Number(doc.imp_neto),
    impIva: Number(doc.imp_iva),
    iva: doc.iva_breakdown.map((i) => ({ id: i.id, baseImp: Number(i.base), importe: Number(i.amount) })),
  }
}

function finish(
  deps: EmitDeps,
  doc: FiscalDocument,
  status: 'authorized' | 'rejected' | 'unknown',
  extra: { cae?: string; caeExpiresOn?: string; request?: unknown; response?: unknown; observations?: unknown } = {},
): Promise<FiscalDocument> {
  return deps.rpc<FiscalDocument>('fiscal_finish', {
    p_document_id: doc.id,
    p_status: status,
    p_cae: extra.cae ?? null,
    p_cae_expires_on: extra.caeExpiresOn ?? null,
    p_request: extra.request ?? null,
    p_response: extra.response ?? null,
    p_observations: extra.observations ?? [],
  })
}

// ---------------------------------------------------------------------------
// Envío y conciliación
// ---------------------------------------------------------------------------

async function send(deps: EmitDeps, doc: FiscalDocument, ticket: TicketDeAcceso, asoc?: Asoc): Promise<EmitResult> {
  const args = solicitarArgsFor(doc, deps.now(), asoc)
  // Solo estos campos se guardan como "solicitud": sin token, firma ni certificado.
  const request = { ...args }
  let response: CaeSolicitarResult
  try {
    response = await deps.arca.solicitar(ticket, args)
  } catch (error) {
    // Sin respuesta (corte, tiempo agotado, error de transporte): NO se reenvía. Queda unknown y se concilia luego.
    const message = error instanceof Error ? error.message : 'sin respuesta'
    const updated = await finish(deps, doc, 'unknown', {
      request,
      observations: [{ code: 'NO_RESPONSE', msg: message.slice(0, 300) }],
    })
    return toResult(updated, true)
  }
  const observations = [...response.observations, ...response.errors, ...response.events]
  if (response.resultado === 'A' && response.cae && response.caeVencimiento) {
    const updated = await finish(deps, doc, 'authorized', {
      cae: response.cae,
      caeExpiresOn: isoDate(response.caeVencimiento),
      request,
      response,
      observations,
    })
    return toResult(updated, false)
  }
  if (response.resultado === 'R' || response.resultado === '') {
    // ARCA respondió y no registró el comprobante (rechazo, o error de cabecera sin resultado).
    const updated = await finish(deps, doc, 'rejected', { request, response, observations })
    return toResult(updated, false)
  }
  // Cualquier otra respuesta (por ejemplo parcial): no se decide a ciegas, queda para conciliar.
  const updated = await finish(deps, doc, 'unknown', { request, response, observations })
  return toResult(updated, true)
}

async function reconcile(deps: EmitDeps, doc: FiscalDocument, ticket: TicketDeAcceso): Promise<EmitResult> {
  const since = Date.parse(doc.sent_at ?? doc.created_at)
  const ageSeconds = (deps.now().getTime() - since) / 1000
  if (!Number.isFinite(ageSeconds) || ageSeconds < SEGUNDOS_EN_VUELO) return toResult(doc, true)

  const found = await deps.arca.consultar(ticket, Number(doc.pto_vta), Number(doc.cbte_tipo), Number(doc.cbte_nro))
  if (found.found) {
    const same = found.impTotal !== null && Math.abs(found.impTotal - Number(doc.imp_total)) < 0.005
    if (found.resultado === 'A' && found.cae && found.caeVencimiento && same) {
      const updated = await finish(deps, doc, 'authorized', {
        cae: found.cae,
        caeExpiresOn: isoDate(found.caeVencimiento),
        response: found,
        observations: [{ code: 'RECONCILED', msg: 'Confirmado por consulta a ARCA' }],
      })
      return toResult(updated, false)
    }
    // Existe en ARCA pero no coincide con lo nuestro: no se toca nada, lo resuelve una persona.
    return toResult(doc, false, { reconcile: 'MISMATCH_WITH_ARCA' })
  }
  if (found.errors.some((e) => e.code === ARCA_COMPROBANTE_NO_EXISTE)) {
    // ARCA confirma que ese número no existe: el envío nunca se registró, es seguro dar el documento por rechazado.
    const updated = await finish(deps, doc, 'rejected', {
      response: found,
      observations: [{ code: 'NOT_REGISTERED', msg: 'ARCA no tiene este comprobante; se puede volver a emitir' }],
    })
    return toResult(updated, false)
  }
  // Otro error al consultar: se sigue sin saber.
  return toResult(doc, true, { reconcile: 'CONSULT_FAILED' })
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

async function checkEnvironment(deps: EmitDeps): Promise<{ environment: string; pto_vta: number }> {
  const settings = await deps.settings()
  if (!settings.environment || settings.environment === 'off') throw new ArcaError('FISCAL_DISABLED', 'La facturación electrónica está desactivada')
  if (settings.environment === 'produccion') {
    throw new ArcaError('PRODUCTION_NOT_IMPLEMENTED', 'Esta función solo emite en homologación')
  }
  if (settings.environment !== 'homologacion' || !settings.pto_vta) {
    throw new ArcaError('NOT_CONFIGURED', 'Falta el punto de venta en la configuración fiscal')
  }
  return { environment: settings.environment, pto_vta: settings.pto_vta }
}

/** Nota de crédito de la factura autorizada de una venta (mismos importes que la factura; contrato §22.5). */
export async function emitCreditNote(deps: EmitDeps, input: Omit<EmitInput, 'receiver'>): Promise<EmitResult> {
  const settings = await checkEnvironment(deps)
  const original = await deps.findInvoice(input.saleId)
  if (!original || original.status !== 'authorized') {
    throw new ArcaError('NO_INVOICE', 'La venta no tiene una factura autorizada para anular')
  }
  const receiver: Receiver = {
    docType: Number(original.receiver_doc_type),
    docNumber: original.receiver_doc_number,
    vatConditionId: Number(original.receiver_vat_condition_id),
  }
  const asoc = [{ tipo: Number(original.cbte_tipo), ptoVta: Number(original.pto_vta), nro: Number(original.cbte_nro) }]
  return await run(deps, settings, input, {
    kind: 'credit_note',
    cbteTipo: Number(original.cbte_tipo) + 2,
    receiver,
    originalId: original.id,
    asoc,
  })
}

export async function emitInvoice(deps: EmitDeps, input: EmitInput): Promise<EmitResult> {
  const settings = await checkEnvironment(deps)
  const { receiver, cbteTipo } = resolveReceiver(input.receiver)
  const charged = await deps.chargedAmount(input.saleId)
  if (charged >= UMBRAL_IDENTIFICACION && receiver.docType === DOC_TIPO.SIN_IDENTIFICAR) {
    throw new ArcaError('IDENTIFICATION_REQUIRED', 'Desde $10.000.000 hay que identificar al comprador')
  }
  return await run(deps, settings, input, { kind: 'invoice', cbteTipo, receiver, originalId: null })
}

async function run(
  deps: EmitDeps,
  settings: { environment: string; pto_vta: number },
  input: Omit<EmitInput, 'receiver'>,
  plan: { kind: 'invoice' | 'credit_note'; cbteTipo: number; receiver: Receiver; originalId: string | null; asoc?: Asoc },
): Promise<EmitResult> {
  const { receiver, cbteTipo } = plan
  const ticket = await getTicket(deps, settings.environment)
  const last = await deps.arca.ultimo(ticket, settings.pto_vta, cbteTipo)
  if (last.errors.length > 0) throw new ArcaError('ARCA_ERROR', `ARCA: ${last.errors[0].code} ${last.errors[0].msg}`.slice(0, 300))

  const doc = await deps.rpc<FiscalDocument>('fiscal_begin', {
    p_idempotency_key: input.idempotencyKey,
    p_sale_id: input.saleId,
    p_kind: plan.kind,
    p_cbte_tipo: cbteTipo,
    p_arca_last: last.cbteNro ?? 0,
    p_created_by: input.createdBy,
    p_receiver_doc_type: receiver.docType,
    p_receiver_doc_number: receiver.docNumber,
    p_receiver_vat_condition_id: receiver.vatConditionId,
    p_original_document_id: plan.originalId,
  })

  if (doc.status === 'authorized' || doc.status === 'rejected') return toResult(doc, false)

  if (doc.status === 'pending' && doc.sent_at === null) {
    const claimed = await deps.rpc<boolean>('fiscal_claim', { p_document_id: doc.id })
    if (claimed === true) return await send(deps, doc, ticket, plan.asoc)
    return toResult(doc, true) // otra llamada ya lo está enviando
  }
  return await reconcile(deps, doc, ticket)
}
