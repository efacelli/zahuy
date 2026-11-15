import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PAGE_SIZE, pageRange } from '../../lib/pagination'

/** Fila de `audit_log` (contrato §5.8). La lee solo el dueño (RLS). */
export interface AuditRow {
  id: number
  table_name: string
  record_id: string
  action: 'insert' | 'update' | 'delete'
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_by: string | null
  changed_at: string
}

/** Tablas auditadas (§5.8, §5.9) con su nombre en la pantalla. */
export const AUDITED_TABLES: Record<string, string> = {
  products: 'Producto',
  product_batches: 'Lote',
  categories: 'Categoría',
  brands: 'Marca',
  suppliers: 'Proveedor',
  profiles: 'Usuario',
  expiry_alert_settings: 'Días de alerta',
}

export const ACTION_LABEL: Record<AuditRow['action'], string> = {
  insert: 'Alta',
  update: 'Edición',
  delete: 'Borrado',
}

export interface AuditParams {
  table: string | null
  page: number
}

export function parseAuditParams(search: URLSearchParams): AuditParams {
  const table = search.get('tabla')
  const page = Number(search.get('pagina'))
  return {
    table: table && table in AUDITED_TABLES ? table : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

export function serializeAuditParams(p: AuditParams): URLSearchParams {
  const out = new URLSearchParams()
  if (p.table) out.set('tabla', p.table)
  if (p.page > 1) out.set('pagina', String(p.page))
  return out
}

const COLUMNS = 'id, table_name, record_id, action, old_data, new_data, changed_by, changed_at'

export async function fetchAuditLog(client: SupabaseClient, p: AuditParams) {
  let q = client.from('audit_log').select(COLUMNS, { count: 'exact' })
  if (p.table) q = q.eq('table_name', p.table)
  const [from, to] = pageRange(p.page, DEFAULT_PAGE_SIZE)
  const { data, error, count } = await q
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { rows: (data ?? []) as AuditRow[], total: count ?? 0 }
}

/** Nombres de usuario por id (todos los activos leen `profiles`, §9). */
export async function fetchProfileNames(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client.from('profiles').select('id, full_name')
  if (error) throw error
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))
}

/* ------------------------------------------------------------------ */
/* Presentación: qué registro es y qué cambió                          */
/* ------------------------------------------------------------------ */

/** Columnas que no se muestran como cambios: las fija la base. */
const HIDDEN_FIELDS = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'creation_key'])

const FIELD_LABEL: Record<string, string> = {
  name: 'nombre',
  full_name: 'nombre',
  sku: 'SKU',
  barcode: 'código de barras',
  description: 'descripción',
  category_id: 'categoría',
  brand_id: 'marca',
  supplier_id: 'proveedor',
  sale_unit: 'unidad de venta',
  cost_price: 'costo',
  sale_price: 'precio',
  vat_rate: 'IVA',
  boxes_quantity: 'cajas',
  units_per_box: 'unidades por caja',
  min_stock: 'stock mínimo',
  is_active: 'activo',
  image_path: 'imagen',
  role: 'rol',
  batch_number: 'número de lote',
  expires_on: 'vencimiento',
  notes: 'observaciones',
  tax_id: 'CUIT',
  phone: 'teléfono',
  email: 'email',
  urgent_days: 'días urgente',
  soon_days: 'días vence pronto',
  notice_days: 'días de aviso',
}

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'sí' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

/** Campos que cambiaron en una edición (sin las columnas que maneja la base). */
export function changedFields(row: Pick<AuditRow, 'action' | 'old_data' | 'new_data'>): FieldChange[] {
  if (row.action !== 'update' || !row.old_data || !row.new_data) return []
  const keys = new Set([...Object.keys(row.old_data), ...Object.keys(row.new_data)])
  return [...keys]
    .filter((k) => !HIDDEN_FIELDS.has(k))
    .filter((k) => JSON.stringify(row.old_data?.[k] ?? null) !== JSON.stringify(row.new_data?.[k] ?? null))
    .sort()
    .map((field) => ({ field, before: row.old_data?.[field] ?? null, after: row.new_data?.[field] ?? null }))
}

/** Nombre legible del registro a partir de los datos guardados. */
export function recordLabel(row: Pick<AuditRow, 'table_name' | 'old_data' | 'new_data'>): string {
  const data = row.new_data ?? row.old_data ?? {}
  const text = (k: string) => (typeof data[k] === 'string' && data[k] !== '' ? (data[k] as string) : null)
  switch (row.table_name) {
    case 'products':
      return [text('sku'), text('name')].filter(Boolean).join(' · ') || 'Producto'
    case 'product_batches':
      return text('batch_number') ? `Lote ${text('batch_number')}` : 'Lote sin número'
    case 'profiles':
      return text('full_name') ?? 'Usuario'
    case 'expiry_alert_settings':
      return data.category_id ? 'Excepción de una categoría' : 'Configuración general'
    default:
      return text('name') ?? AUDITED_TABLES[row.table_name] ?? row.table_name
  }
}
