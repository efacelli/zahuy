import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from '../../lib/errors'
import { parseDecimalInput } from '../../lib/numbers'

/*
 * Configuración de ventas (`sales_settings`, una sola fila): redondeo (§15.3.8),
 * descuento por cantidad (§16.2) y datos del comercio para el ticket (§18.2).
 * Los datos del comercio llegan con la migración de §18: hasta entonces la
 * pantalla los muestra deshabilitados y el ticket sale sin encabezado.
 */

export interface SalesSettings {
  id: string
  rounding_multiple: number
  quantity_discount_step: number
  quantity_discount_percent: number
  quantity_discount_max_percent: number
  store_name: string | null
  store_address: string | null
  store_tax_id: string | null
  /** `false` si la base todavía no tiene las columnas de §18. */
  storeAvailable: boolean
}

export interface StoreInfo {
  store_name: string | null
  store_address: string | null
  store_tax_id: string | null
}

export const SALES_SETTINGS_KEY = ['sales-settings'] as const
export const STORE_INFO_KEY = ['store-info'] as const

const BASE_COLUMNS = 'id, rounding_multiple, quantity_discount_step, quantity_discount_percent, quantity_discount_max_percent'
const STORE_COLUMNS = 'store_name, store_address, store_tax_id'

type Row = Record<string, unknown>

function toSettings(row: Row, storeAvailable: boolean): SalesSettings {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  return {
    id: String(row.id),
    rounding_multiple: Number(row.rounding_multiple),
    quantity_discount_step: Number(row.quantity_discount_step),
    quantity_discount_percent: Number(row.quantity_discount_percent),
    quantity_discount_max_percent: Number(row.quantity_discount_max_percent),
    store_name: text(row.store_name),
    store_address: text(row.store_address),
    store_tax_id: text(row.store_tax_id),
    storeAvailable,
  }
}

export async function fetchSalesSettings(client: SupabaseClient): Promise<SalesSettings | null> {
  const full = await client.from('sales_settings').select(`${BASE_COLUMNS}, ${STORE_COLUMNS}`).limit(1)
  if (!full.error) {
    const row = ((full.data ?? []) as Row[])[0]
    return row ? toSettings(row, true) : null
  }
  if (!isMissingColumn(full.error)) throw full.error
  const base = await client.from('sales_settings').select(BASE_COLUMNS).limit(1)
  if (base.error) throw base.error
  const row = ((base.data ?? []) as Row[])[0]
  return row ? toSettings(row, false) : null
}

/** Encabezado del ticket. Cualquier error (o la migración pendiente) = ticket sin encabezado. */
export async function fetchStoreInfo(client: SupabaseClient): Promise<StoreInfo | null> {
  const { data, error } = await client.from('sales_settings').select(STORE_COLUMNS).limit(1)
  if (error) return null
  const row = ((data ?? []) as Row[])[0]
  if (!row) return null
  const s = toSettings({ ...row, id: '' }, true)
  return { store_name: s.store_name, store_address: s.store_address, store_tax_id: s.store_tax_id }
}

export interface SalesSettingsValues {
  rounding_multiple: string
  quantity_discount_step: string
  quantity_discount_percent: string
  quantity_discount_max_percent: string
  store_name: string
  store_address: string
  store_tax_id: string
}

export type SalesSettingsErrors = Partial<Record<keyof SalesSettingsValues, string>>

export type SalesSettingsUpdate = Partial<Omit<SalesSettings, 'id' | 'storeAvailable'>>

export function settingsToForm(s: SalesSettings): SalesSettingsValues {
  const num = (n: number) => String(n).replace('.', ',')
  return {
    rounding_multiple: num(s.rounding_multiple),
    quantity_discount_step: String(s.quantity_discount_step),
    quantity_discount_percent: num(s.quantity_discount_percent),
    quantity_discount_max_percent: num(s.quantity_discount_max_percent),
    store_name: s.store_name ?? '',
    store_address: s.store_address ?? '',
    store_tax_id: s.store_tax_id ? formatTaxId(s.store_tax_id) : '',
  }
}

/** CUIT de 11 dígitos con el formato NN-NNNNNNNN-N (§18.2); si no tiene 11 dígitos, tal cual. */
export function formatTaxId(raw: string): string {
  const d = raw.replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : raw
}

/** Dígito verificador del CUIT (módulo 11). La base no lo valida (§18.2): lo avisa la pantalla. */
export function isValidTaxId(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
  const mod = 11 - (sum % 11)
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod
  return check === Number(digits[10])
}

/** Valida como la base (CHECK de §15.3.8, §16.2 y §18.2) para avisar antes de guardar. */
export function validateSalesSettings(
  values: SalesSettingsValues,
  storeAvailable: boolean,
): { errors: SalesSettingsErrors; update: SalesSettingsUpdate | null } {
  const errors: SalesSettingsErrors = {}
  const rounding = parseDecimalInput(values.rounding_multiple)
  if (rounding === null || rounding <= 0) errors.rounding_multiple = 'Escribí un monto mayor que 0 (por ejemplo, 100).'

  const step = parseDecimalInput(values.quantity_discount_step)
  if (step === null || !Number.isInteger(step) || step <= 0)
    errors.quantity_discount_step = 'Escribí una cantidad entera de unidades, mayor que 0.'

  const percent = parseDecimalInput(values.quantity_discount_percent)
  if (percent === null || percent >= 100) errors.quantity_discount_percent = 'Escribí un porcentaje entre 0 y 99,99.'

  const max = parseDecimalInput(values.quantity_discount_max_percent)
  if (max === null || max >= 100) errors.quantity_discount_max_percent = 'Escribí un porcentaje entre 0 y 99,99.'
  else if (percent !== null && max < percent && !errors.quantity_discount_percent)
    errors.quantity_discount_max_percent = 'El tope no puede ser menor que el descuento de cada escalón.'

  const update: SalesSettingsUpdate = {
    rounding_multiple: rounding ?? undefined,
    quantity_discount_step: step ?? undefined,
    quantity_discount_percent: percent ?? undefined,
    quantity_discount_max_percent: max ?? undefined,
  }

  if (storeAvailable) {
    const name = values.store_name.trim()
    const address = values.store_address.trim()
    const taxId = values.store_tax_id.replace(/[\s-]/g, '')
    if (name.length > 80) errors.store_name = 'Hasta 80 caracteres.'
    if (address.length > 120) errors.store_address = 'Hasta 120 caracteres.'
    if (taxId !== '' && !/^\d{11}$/.test(taxId)) errors.store_tax_id = 'El CUIT tiene 11 dígitos (por ejemplo, 20-12345678-3).'
    else if (taxId !== '' && !isValidTaxId(taxId)) errors.store_tax_id = 'El dígito verificador no coincide: revisá el CUIT.'
    update.store_name = name || null
    update.store_address = address || null
    update.store_tax_id = taxId || null
  }

  return Object.keys(errors).length > 0 ? { errors, update: null } : { errors, update }
}

export async function updateSalesSettings(client: SupabaseClient, id: string, update: SalesSettingsUpdate): Promise<void> {
  // Con RLS, un UPDATE sin permiso no da error: no cambia ninguna fila. Por eso se pide el id de vuelta.
  const { data, error } = await client.from('sales_settings').update(update).eq('id', id).select('id')
  if (error) throw error
  if (((data ?? []) as unknown[]).length === 0) {
    throw Object.assign(new Error('permission denied for sales_settings'), { code: '42501' })
  }
}
