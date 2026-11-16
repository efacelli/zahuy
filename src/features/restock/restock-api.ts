import type { SupabaseClient } from '@supabase/supabase-js'
import { isIntegerUnit, type SaleUnit } from '../../domain/units'

/**
 * Lista de reposición: productos activos con stock en el mínimo o por debajo
 * (`is_low_stock`, contrato §7.2), agrupados por proveedor.
 *
 * Solo entran los que tienen un stock mínimo configurado (`min_stock > 0`): con
 * mínimo 0, todo producto sin stock figura como "stock bajo" (P-08) y la lista
 * se llenaría de productos que nadie pidió reponer.
 */
export interface RestockRow {
  id: string
  sku: string
  name: string
  brand_name: string
  supplier_id: string | null
  supplier_name: string | null
  sale_unit: SaleUnit
  units_per_box: number
  min_stock: number
  stock_quantity: number
}

export interface RestockItem extends RestockRow {
  /** Lo que falta para llegar al mínimo (0 si está justo en el mínimo). */
  to_order: number
  /** Cajas cerradas que cubren lo que falta (solo unidades enteras con más de una por caja). */
  boxes_to_order: number | null
}

export interface RestockGroup {
  supplierId: string | null
  supplierName: string
  items: RestockItem[]
}

export const NO_SUPPLIER_LABEL = 'Sin proveedor'

const COLUMNS = 'id, sku, name, brand_name, supplier_id, supplier_name, sale_unit, units_per_box, min_stock, stock_quantity'
const PAGE = 1000

export async function fetchRestockRows(client: SupabaseClient): Promise<RestockRow[]> {
  const rows: RestockRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('v_product_list')
      .select(COLUMNS)
      .eq('is_active', true)
      .eq('is_low_stock', true)
      .gt('min_stock', 0)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const page = ((data ?? []) as unknown as RestockRow[]).map(normalize)
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/** `numeric` puede llegar como texto. */
function normalize(r: RestockRow): RestockRow {
  return {
    ...r,
    units_per_box: Number(r.units_per_box),
    min_stock: Number(r.min_stock),
    stock_quantity: Number(r.stock_quantity),
  }
}

/** Cuánto pedir para llegar al mínimo; en unidades enteras, redondea hacia arriba. */
export function quantityToOrder(row: Pick<RestockRow, 'min_stock' | 'stock_quantity' | 'sale_unit'>): number {
  const missing = Math.max(row.min_stock - row.stock_quantity, 0)
  if (isIntegerUnit(row.sale_unit)) return Math.ceil(missing)
  return Math.round(missing * 1000) / 1000
}

export function boxesToOrder(toOrder: number, row: Pick<RestockRow, 'units_per_box' | 'sale_unit'>): number | null {
  if (toOrder <= 0 || !isIntegerUnit(row.sale_unit) || row.units_per_box <= 1) return null
  return Math.ceil(toOrder / row.units_per_box)
}

/** Agrupa por proveedor (alfabético, "Sin proveedor" al final); dentro, por nombre. */
export function groupBySupplier(rows: RestockRow[]): RestockGroup[] {
  const groups = new Map<string, RestockGroup>()
  for (const row of rows) {
    const key = row.supplier_id ?? ''
    let group = groups.get(key)
    if (!group) {
      group = { supplierId: row.supplier_id, supplierName: row.supplier_name ?? NO_SUPPLIER_LABEL, items: [] }
      groups.set(key, group)
    }
    const to_order = quantityToOrder(row)
    group.items.push({ ...row, to_order, boxes_to_order: boxesToOrder(to_order, row) })
  }
  const list = [...groups.values()]
  list.forEach((g) => g.items.sort((a, b) => a.name.localeCompare(b.name, 'es')))
  return list.sort((a, b) => {
    if (a.supplierId === null) return 1
    if (b.supplierId === null) return -1
    return a.supplierName.localeCompare(b.supplierName, 'es')
  })
}
