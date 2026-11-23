import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * Facturación electrónica ARCA (contrato §22). La base guarda los comprobantes (`fiscal_documents`) y la
 * Edge Function `arca-emitir` los emite: el navegador nunca habla con ARCA ni ve certificados ni tokens.
 */

export type FiscalEnvironment = 'off' | 'homologacion' | 'produccion'
export type FiscalStatus = 'pending' | 'authorized' | 'rejected' | 'unknown'
export type FiscalKind = 'invoice' | 'credit_note'

export interface FiscalSettings {
  id: string
  environment: FiscalEnvironment
  pto_vta: number | null
  caea_pto_vta: number | null
  /** Datos del emisor que van impresos en la factura (§22.11); null mientras no se carguen. */
  issuer_name: string | null
  issuer_tax_id: string | null
  issuer_address: string | null
  gross_income_number: string | null
  /** AAAA-MM-DD */
  activity_start_date: string | null
  /** false si la base todavía no tiene las columnas del emisor. */
  issuerAvailable: boolean
}

export interface FiscalDocumentRow {
  id: string
  sale_id: string
  kind: FiscalKind
  cbte_tipo: number
  pto_vta: number
  cbte_nro: number
  environment: 'homologacion' | 'produccion'
  status: FiscalStatus
  cae: string | null
  cae_expires_on: string | null
  imp_total: number
  imp_neto: number
  imp_iva: number
  iva_breakdown: { id: number; rate: number; base: number; amount: number }[]
  receiver_doc_type: number
  receiver_doc_number: string
  receiver_vat_condition_id: number
  authorized_at: string | null
  created_at: string
}

export const CBTE_LABEL: Record<number, string> = {
  1: 'Factura A',
  6: 'Factura B',
  3: 'Nota de crédito A',
  8: 'Nota de crédito B',
}

export const FISCAL_STATUS_LABEL: Record<FiscalStatus, string> = {
  authorized: 'Autorizado',
  rejected: 'Rechazado por ARCA',
  unknown: 'Sin confirmar',
  pending: 'En proceso',
}

/** 00011-00000012: punto de venta de 5 dígitos y número de 8. */
export const formatCbteNumber = (ptoVta: number, nro: number) => `${String(ptoVta).padStart(5, '0')}-${String(nro).padStart(8, '0')}`

/** Condiciones frente al IVA del receptor (tabla de ARCA). A: inscriptos y monotributo; B: el resto. */
export const VAT_CONDITIONS = [
  { id: 5, label: 'Consumidor final', factura: 'B' },
  { id: 1, label: 'Responsable inscripto', factura: 'A' },
  { id: 6, label: 'Monotributo', factura: 'A' },
  { id: 13, label: 'Monotributista social', factura: 'A' },
  { id: 16, label: 'Monotributo trabajador independiente promovido', factura: 'A' },
  { id: 4, label: 'IVA exento', factura: 'B' },
  { id: 7, label: 'Sujeto no categorizado', factura: 'B' },
] as const

export const DOC_TYPES = { CUIT: 80, DNI: 96, NONE: 99 } as const

/** Datos del cliente para el comprobante, ya validados. */
export interface ReceiverForm {
  identify: boolean
  docType: number
  docNumber: string
  vatConditionId: number
}

export const EMPTY_RECEIVER: ReceiverForm = { identify: false, docType: DOC_TYPES.CUIT, docNumber: '', vatConditionId: 5 }

/** Mismas reglas que la función: la Factura A pide CUIT; el CUIT tiene 11 dígitos y el DNI 7 u 8. */
export function receiverError(form: ReceiverForm): string | null {
  if (!form.identify) return null
  const condition = VAT_CONDITIONS.find((c) => c.id === form.vatConditionId)
  const digits = form.docNumber.trim()
  if (form.docType === DOC_TYPES.CUIT && !/^\d{11}$/.test(digits)) return 'El CUIT tiene 11 dígitos, sin guiones.'
  if (form.docType === DOC_TYPES.DNI && !/^\d{7,8}$/.test(digits)) return 'El DNI tiene 7 u 8 dígitos.'
  if (condition?.factura === 'A' && form.docType !== DOC_TYPES.CUIT) return 'La Factura A necesita el CUIT del cliente.'
  return null
}

/** null si la base todavía no tiene la facturación (la sección no se muestra). */
const SETTINGS_BASE = 'id, environment, pto_vta, caea_pto_vta'
const SETTINGS_ISSUER = 'issuer_name, issuer_tax_id, issuer_address, gross_income_number, activity_start_date'

export async function fetchFiscalSettings(client: SupabaseClient): Promise<FiscalSettings | null> {
  let issuerAvailable = true
  const full = await client.from('fiscal_settings').select(`${SETTINGS_BASE}, ${SETTINGS_ISSUER}`).limit(1)
  let rows = full.data as unknown as Partial<FiscalSettings>[] | null
  let failed = full.error
  if (failed) {
    // Base sin las columnas del emisor (§22.11): se pide sin ellas y la factura se imprime sin ese encabezado.
    issuerAvailable = false
    const base = await client.from('fiscal_settings').select(SETTINGS_BASE).limit(1)
    rows = base.data as unknown as Partial<FiscalSettings>[] | null
    failed = base.error
  }
  if (failed) return null
  const row = (rows ?? [])[0]
  if (!row) return null
  return {
    id: String(row.id),
    environment: row.environment as FiscalEnvironment,
    pto_vta: row.pto_vta == null ? null : Number(row.pto_vta),
    caea_pto_vta: row.caea_pto_vta == null ? null : Number(row.caea_pto_vta),
    issuer_name: row.issuer_name ?? null,
    issuer_tax_id: row.issuer_tax_id ?? null,
    issuer_address: row.issuer_address ?? null,
    gross_income_number: row.gross_income_number ?? null,
    activity_start_date: row.activity_start_date ?? null,
    issuerAvailable,
  }
}

export const documentsKey = (saleId: string) => ['fiscal-documents', saleId] as const

const DOCUMENT_COLUMNS =
  'id, sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, status, cae, cae_expires_on, imp_total, imp_neto, imp_iva, ' +
  'iva_breakdown, receiver_doc_type, receiver_doc_number, receiver_vat_condition_id, authorized_at, created_at'

/** Comprobantes de una venta, del más viejo al más nuevo. La RLS decide qué se ve (§22.2). */
export async function fetchSaleDocuments(client: SupabaseClient, saleId: string): Promise<FiscalDocumentRow[]> {
  const { data, error } = await client
    .from('fiscal_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('sale_id', saleId)
    .order('created_at', { ascending: true })
  if (error) return []
  return ((data ?? []) as unknown as FiscalDocumentRow[]).map((d) => ({
    ...d,
    cbte_tipo: Number(d.cbte_tipo),
    pto_vta: Number(d.pto_vta),
    cbte_nro: Number(d.cbte_nro),
    imp_total: Number(d.imp_total),
    imp_neto: Number(d.imp_neto),
    imp_iva: Number(d.imp_iva),
    receiver_doc_type: Number(d.receiver_doc_type),
    receiver_vat_condition_id: Number(d.receiver_vat_condition_id),
    iva_breakdown: (d.iva_breakdown ?? []).map((i) => ({ id: Number(i.id), rate: Number(i.rate), base: Number(i.base), amount: Number(i.amount) })),
  }))
}

export interface EmitRequest {
  action: 'invoice' | 'credit_note'
  sale_id: string
  idempotency_key: string
  receiver?: { docType: number; docNumber: string; vatConditionId: number }
}

export interface EmitOutcome {
  httpStatus: number
  /** Autorizado por ARCA. */
  ok: boolean
  status: FiscalStatus | null
  /** Hay un envío en curso o sin confirmar: volver a consultar en unos segundos. */
  inProgress: boolean
  code: string | null
  document: { cbte_tipo: number; pto_vta: number; cbte_nro: number; cae: string | null; cae_expires_on: string | null; imp_total: number } | null
  /** Pide que lo resuelva una persona (por ejemplo, importes distintos entre Zahuy y ARCA). */
  reconcile: string | null
}

interface EmitBody {
  ok?: boolean
  status?: FiscalStatus
  inProgress?: boolean
  code?: string
  document?: EmitOutcome['document']
  reconcile?: string
}

function toOutcome(httpStatus: number, body: EmitBody | null): EmitOutcome {
  return {
    httpStatus,
    ok: body?.ok === true,
    status: body?.status ?? null,
    inProgress: body?.inProgress === true,
    code: body?.code ?? null,
    document: body?.document ?? null,
    reconcile: body?.reconcile ?? null,
  }
}

/**
 * Llama a la función. Un 202 (en curso) o un 422 (rechazado) no son errores de red: supabase-js los entrega
 * como error con la respuesta en `context`, y acá se leen para mostrar qué pasó.
 */
export async function emitFiscalDocument(client: SupabaseClient, request: EmitRequest): Promise<EmitOutcome> {
  const { data, error } = await client.functions.invoke('arca-emitir', { body: request })
  if (!error) return toOutcome(200, data as EmitBody)
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === 'function') {
    const body = (await context.json().catch(() => null)) as EmitBody | null
    return toOutcome(context.status, body)
  }
  throw error
}

/** Mensajes de la función (códigos de §22.9 y §22.10), listos para mostrar. */
export const FISCAL_MESSAGES: Record<string, string> = {
  FISCAL_DISABLED: 'La facturación electrónica está desactivada.',
  PRODUCTION_NOT_IMPLEMENTED: 'Por ahora solo se puede facturar en el ambiente de prueba (homologación).',
  ENVIRONMENT_MISMATCH: 'La facturación está configurada en otro ambiente que el servidor. Avisá al administrador.',
  NOT_AUTHENTICATED: 'Tu sesión venció. Ingresá de nuevo.',
  NOT_AUTHORIZED: 'No tenés permiso para facturar esta venta.',
  INVALID_RECEIVER: 'Revisá los datos del cliente: el documento no es válido o la Factura A necesita el CUIT.',
  IDENTIFICATION_REQUIRED: 'Desde $10.000.000 hay que identificar al comprador con su DNI o CUIT.',
  NO_INVOICE: 'Esta venta no tiene una factura autorizada para anular.',
  TICKET_UNAVAILABLE: 'ARCA no está disponible por unos minutos. Probá de nuevo más tarde.',
  SALE_VOIDED: 'La venta está anulada: no se puede facturar.',
  SALE_NOT_FOUND: 'La venta no existe o no está disponible.',
  IDEMPOTENCY_CONFLICT: 'Ese pedido ya se había enviado con otros datos. Recargá la pantalla y revisá los comprobantes.',
  FISCAL_UNSUPPORTED_VAT: 'La venta tiene una alícuota de IVA que no se puede facturar con este sistema.',
  ARCA_ERROR: 'ARCA respondió con un error. Probá de nuevo en unos minutos.',
}

export const fiscalMessage = (code: string | null) =>
  (code && FISCAL_MESSAGES[code]) || 'No se pudo emitir el comprobante. Si se repite, avisá al administrador.'

// ---------------------------------------------------------------------------
// Configuración fiscal (Configuración, solo dueño y programador) y datos del emisor (§22.11)
// ---------------------------------------------------------------------------

export const FISCAL_SETTINGS_KEY = ['fiscal-settings'] as const

export interface FiscalSettingsForm {
  environment: FiscalEnvironment
  pto_vta: string
  caea_pto_vta: string
  issuer_name: string
  issuer_tax_id: string
  issuer_address: string
  gross_income_number: string
  activity_start_date: string
}

export type FiscalSettingsErrors = Partial<Record<keyof FiscalSettingsForm, string>>

export const settingsToForm = (s: FiscalSettings): FiscalSettingsForm => ({
  environment: s.environment,
  pto_vta: s.pto_vta === null ? '' : String(s.pto_vta),
  caea_pto_vta: s.caea_pto_vta === null ? '' : String(s.caea_pto_vta),
  issuer_name: s.issuer_name ?? '',
  issuer_tax_id: s.issuer_tax_id ?? '',
  issuer_address: s.issuer_address ?? '',
  gross_income_number: s.gross_income_number ?? '',
  activity_start_date: s.activity_start_date ?? '',
})

const orNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Mismas reglas que la base (CHECK de §22.2 y §22.11); el ambiente `produccion` no se cambia desde la app. */
export function validateFiscalSettings(
  form: FiscalSettingsForm,
  issuerAvailable: boolean,
  today = new Date(),
): { errors: FiscalSettingsErrors; update: Record<string, unknown> | null } {
  const errors: FiscalSettingsErrors = {}
  const port = (value: string, label: string) => {
    if (value.trim() === '') return null
    return /^\d{1,5}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 99998 ? null : `${label}: un número entre 1 y 99998.`
  }
  const pto = port(form.pto_vta, 'Punto de venta')
  if (pto) errors.pto_vta = pto
  else if (form.environment !== 'off' && form.pto_vta.trim() === '') errors.pto_vta = 'Falta el punto de venta para activar la facturación.'
  const caea = port(form.caea_pto_vta, 'Punto de venta de CAEA')
  if (caea) errors.caea_pto_vta = caea
  else if (form.caea_pto_vta.trim() !== '' && form.caea_pto_vta.trim() === form.pto_vta.trim()) {
    errors.caea_pto_vta = 'Tiene que ser distinto del punto de venta principal.'
  }
  if (issuerAvailable) {
    const name = form.issuer_name.trim()
    if (name !== '' && name.length > 80) errors.issuer_name = 'Hasta 80 caracteres.'
    if (form.issuer_tax_id.trim() !== '' && !/^\d{11}$/.test(form.issuer_tax_id.trim())) errors.issuer_tax_id = 'El CUIT tiene 11 dígitos, sin guiones.'
    if (form.issuer_address.trim().length > 120) errors.issuer_address = 'Hasta 120 caracteres.'
    if (form.gross_income_number.trim() !== '' && !/^[0-9-]{1,20}$/.test(form.gross_income_number.trim())) {
      errors.gross_income_number = 'Solo números y guiones (hasta 20).'
    }
    const date = form.activity_start_date.trim()
    if (date !== '') {
      const parsed = Date.parse(`${date}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed)) errors.activity_start_date = 'Fecha inválida.'
      else if (parsed > today.getTime()) errors.activity_start_date = 'No puede ser futura.'
    }
  }
  if (Object.keys(errors).length > 0) return { errors, update: null }
  const update: Record<string, unknown> = {
    pto_vta: orNull(form.pto_vta) === null ? null : Number(form.pto_vta),
    caea_pto_vta: orNull(form.caea_pto_vta) === null ? null : Number(form.caea_pto_vta),
  }
  // Producción no se activa ni se desactiva desde la app (decisión aparte, §22.1).
  if (form.environment === 'off' || form.environment === 'homologacion') update.environment = form.environment
  if (issuerAvailable) {
    update.issuer_name = orNull(form.issuer_name)
    update.issuer_tax_id = orNull(form.issuer_tax_id)
    update.issuer_address = orNull(form.issuer_address)
    update.gross_income_number = orNull(form.gross_income_number)
    update.activity_start_date = orNull(form.activity_start_date)
  }
  return { errors, update }
}

export async function saveFiscalSettings(client: SupabaseClient, id: string, update: Record<string, unknown>): Promise<void> {
  const { error } = await client.from('fiscal_settings').update(update).eq('id', id)
  if (error) throw error
}

/** Qué datos del emisor faltan para que la factura salga completa (vacío = está todo). */
export function issuerMissing(s: FiscalSettings | null): string[] {
  if (!s) return []
  const missing: string[] = []
  if (!s.issuer_name) missing.push('razón social')
  if (!s.issuer_tax_id) missing.push('CUIT')
  if (!s.issuer_address) missing.push('domicilio comercial')
  if (!s.gross_income_number) missing.push('Ingresos Brutos')
  if (!s.activity_start_date) missing.push('inicio de actividades')
  return missing
}

// ---------------------------------------------------------------------------
// Código QR de ARCA (RG 4892): la URL lleva un JSON en base64 con los datos del comprobante autorizado.
// ---------------------------------------------------------------------------

/** AAAA-MM-DD en hora de Argentina. */
export function arDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function arcaQrUrl(doc: FiscalDocumentRow, issuerTaxId: string | null): string | null {
  if (doc.status !== 'authorized' || !doc.cae || !doc.authorized_at || !issuerTaxId || !/^\d{11}$/.test(issuerTaxId)) return null
  const payload = {
    ver: 1,
    fecha: arDate(doc.authorized_at),
    cuit: Number(issuerTaxId),
    ptoVta: doc.pto_vta,
    tipoCmp: doc.cbte_tipo,
    nroCmp: doc.cbte_nro,
    importe: doc.imp_total,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: doc.receiver_doc_type,
    nroDocRec: Number(doc.receiver_doc_number),
    tipoCodAut: 'E',
    codAut: Number(doc.cae),
  }
  return `https://www.afip.gob.ar/fe/qr/?p=${encodeURIComponent(btoa(JSON.stringify(payload)))}`
}
