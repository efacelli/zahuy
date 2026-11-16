import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaleUnit } from '../../domain/units'

/*
 * Etiquetas de góndola: solo lectura. El precio es el final con IVA que calcula
 * la base (v_product_list.sale_price_with_vat); acá no se recalcula nada.
 */

export interface LabelProduct {
  id: string
  sku: string
  barcode: string | null
  name: string
  brand_name: string
  sale_unit: SaleUnit
  sale_price_with_vat: number
}

export interface LabelItem {
  product: LabelProduct
  copies: number
}

export type LabelFormat = 'a4-24' | 'a4-10'

export const LABEL_FORMATS: { value: LabelFormat; label: string }[] = [
  { value: 'a4-24', label: 'Chicas: hoja A4 de 24 (3 × 8, 70 × 37 mm)' },
  { value: 'a4-10', label: 'Grandes: hoja A4 de 10 (2 × 5, 105 × 59 mm)' },
]

export const LABELS_PER_SHEET: Record<LabelFormat, number> = { 'a4-24': 24, 'a4-10': 10 }

export const MAX_COPIES = 50
/** Tope de productos que se agregan de una vez (evita hojas gigantes por error). */
export const MAX_BATCH = 500

const COLUMNS = 'id, sku, barcode, name, brand_name, sale_unit, sale_price_with_vat'
/** Ids por pedido: más largos rompen el largo máximo de la URL. */
const IDS_PER_REQUEST = 150

/** Precio por unidad para los productos que se venden a granel. */
export const PRICE_UNIT_SUFFIX: Partial<Record<SaleUnit, string>> = { kg: 'por kg', l: 'por litro' }

function normalize(r: LabelProduct): LabelProduct {
  return { ...r, sale_price_with_vat: Number(r.sale_price_with_vat) }
}

/** Productos activos por id, ordenados por nombre. */
export async function fetchLabelProducts(client: SupabaseClient, ids: string[]): Promise<LabelProduct[]> {
  const unique = [...new Set(ids)]
  const result: LabelProduct[] = []
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const { data, error } = await client
      .from('v_product_list')
      .select(COLUMNS)
      .in('id', unique.slice(i, i + IDS_PER_REQUEST))
      .eq('is_active', true)
    if (error) throw error
    result.push(...((data ?? []) as unknown as LabelProduct[]).map(normalize))
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Productos activos de una marca o una categoría. */
export async function fetchLabelProductsByCatalog(
  client: SupabaseClient,
  column: 'brand_id' | 'category_id',
  id: string,
): Promise<LabelProduct[]> {
  const { data, error } = await client
    .from('v_product_list')
    .select(COLUMNS)
    .eq(column, id)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(MAX_BATCH)
  if (error) throw error
  return ((data ?? []) as unknown as LabelProduct[]).map(normalize)
}

interface HistoryRow {
  product_id: string
  old_sale_price: number
  new_sale_price: number
}

function changedIds(rows: HistoryRow[]): string[] {
  return [
    ...new Set(rows.filter((r) => Number(r.old_sale_price) !== Number(r.new_sale_price)).map((r) => r.product_id)),
  ]
}

/** Productos cuyo precio cambió en un aumento masivo (solo encargado y dueño: §19.2). */
export async function productIdsOfBulkChange(client: SupabaseClient, bulkChangeId: string): Promise<string[]> {
  const { data, error } = await client
    .from('price_history')
    .select('product_id, old_sale_price, new_sale_price')
    .eq('bulk_change_id', bulkChangeId)
    .limit(5000)
  if (error) throw error
  return changedIds((data ?? []) as HistoryRow[])
}

/** Productos cuyo precio cambió desde el inicio de un día (hora argentina). */
export async function productIdsChangedSince(client: SupabaseClient, isoDate: string): Promise<string[]> {
  const { data, error } = await client
    .from('price_history')
    .select('product_id, old_sale_price, new_sale_price')
    .gte('changed_at', `${isoDate}T00:00:00-03:00`)
    .order('changed_at', { ascending: false })
    .limit(5000)
  if (error) throw error
  return changedIds((data ?? []) as HistoryRow[])
}

/** Suma productos a la lista sin repetir los que ya estaban. */
export function mergeItems(current: LabelItem[], products: LabelProduct[]): { items: LabelItem[]; added: number } {
  const known = new Set(current.map((i) => i.product.id))
  const fresh = products.filter((p) => !known.has(p.id))
  return { items: [...current, ...fresh.map((product) => ({ product, copies: 1 }))], added: fresh.length }
}

/** Una entrada por etiqueta impresa, respetando las copias. */
export function expandLabels(items: LabelItem[]): LabelProduct[] {
  return items.flatMap((i) => Array.from({ length: i.copies }, () => i.product))
}

/** Copias válidas: entero de 1 a MAX_COPIES. */
export function parseCopies(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null
  const n = Number(raw)
  return n >= 1 && n <= MAX_COPIES ? n : null
}
