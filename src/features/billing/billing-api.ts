import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * Facturación electrónica ARCA (contrato §22). La base guarda los comprobantes (`fiscal_documents`) y la
 * Edge Function `arca-emitir` los emite: el navegador nunca habla con ARCA ni ve certificados ni tokens.
 */

export type FiscalEnvironment = 'off' | 'homologacion' | 'produccion'
export type FiscalStatus = 'pending' | 'authorized' | 'rejected' | 'unknown'
export type FiscalKind = 'invoice' | 'credit_note'

export interface FiscalSettings {
  environment: FiscalEnvironment
  pto_vta: number | null
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
export async function fetchFiscalSettings(client: SupabaseClient): Promise<FiscalSettings | null> {
  const { data, error } = await client.from('fiscal_settings').select('environment, pto_vta').limit(1)
  if (error) return null
  const row = ((data ?? []) as FiscalSettings[])[0]
  return row ? { environment: row.environment, pto_vta: row.pto_vta === null ? null : Number(row.pto_vta) } : null
}

const DOCUMENT_COLUMNS = 'id, sale_id, kind, cbte_tipo, pto_vta, cbte_nro, environment, status, cae, cae_expires_on, imp_total, created_at'

/** Comprobantes de una venta, del más viejo al más nuevo. La RLS decide qué se ve (§22.2). */
export async function fetchSaleDocuments(client: SupabaseClient, saleId: string): Promise<FiscalDocumentRow[]> {
  const { data, error } = await client
    .from('fiscal_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('sale_id', saleId)
    .order('created_at', { ascending: true })
  if (error) return []
  return ((data ?? []) as FiscalDocumentRow[]).map((d) => ({
    ...d,
    cbte_tipo: Number(d.cbte_tipo),
    pto_vta: Number(d.pto_vta),
    cbte_nro: Number(d.cbte_nro),
    imp_total: Number(d.imp_total),
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
