import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPIRY_STATUS_LABEL } from '../../domain/expiry'
import { SALE_UNIT_LABEL } from '../../domain/units'
import { fetchProductList, type ProductListRow } from './list-api'
import type { ProductListParams } from './list-params'

/*
 * Exportar el listado de productos (con los filtros y el orden de la pantalla) a
 * un CSV que Excel en español abre directo: UTF-8 con BOM, separador ";" y coma
 * decimal. Solo lectura; no agrega dependencias.
 */

const EXPORT_PAGE_SIZE = 1000
/** Tope de seguridad: el catálogo real tiene unos 3000 productos. */
export const MAX_EXPORT_ROWS = 20_000

/** Trae todas las páginas del listado con los mismos filtros y orden. */
export async function fetchAllProducts(client: SupabaseClient, params: ProductListParams): Promise<ProductListRow[]> {
  const rows: ProductListRow[] = []
  for (let page = 1; rows.length < MAX_EXPORT_ROWS; page++) {
    const { rows: chunk } = await fetchProductList(client, { ...params, page, pageSize: EXPORT_PAGE_SIZE })
    rows.push(...chunk)
    if (chunk.length < EXPORT_PAGE_SIZE) break
  }
  return rows.slice(0, MAX_EXPORT_ROWS)
}

type Cell = string | number | null

/** Número con coma decimal y sin separador de miles (Excel lo toma como número). */
function decimal(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(Number(n))) return ''
  return Number(n).toFixed(digits).replace('.', ',')
}

/** Comillas cuando hace falta; y un apóstrofo delante de =, +, -, @ para que Excel no lo tome como fórmula. */
export function csvCell(value: Cell): string {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const HEADERS = [
  'SKU',
  'Código de barras',
  'Nombre',
  'Marca',
  'Categoría',
  'Proveedor',
  'Unidad',
  'Costo sin IVA',
  'Precio sin IVA',
  'IVA %',
  'Precio final',
  'Stock',
  'Cajas',
  'Unidades por caja',
  'Stock mínimo',
  'Stock bajo',
  'Próximo vencimiento',
  'Estado de vencimiento',
  'Activo',
]

export function productsToCsv(rows: ProductListRow[]): string {
  const lines = [HEADERS.map(csvCell).join(';')]
  for (const r of rows) {
    const cells: Cell[] = [
      // Texto: así Excel no le saca los ceros de adelante ni lo pasa a notación científica.
      `="${r.sku}"`,
      r.barcode ? `="${r.barcode}"` : '',
      r.name,
      r.brand_name,
      r.category_name,
      r.supplier_name,
      SALE_UNIT_LABEL[r.sale_unit],
      decimal(r.cost_price),
      decimal(r.sale_price, 4),
      decimal(r.vat_rate, 1),
      decimal(r.sale_price_with_vat),
      decimal(r.stock_quantity, 3).replace(/,?0+$/, ''),
      r.boxes_quantity,
      r.units_per_box,
      decimal(r.min_stock, 3).replace(/,?0+$/, ''),
      r.is_low_stock ? 'Sí' : 'No',
      r.next_expires_on ? r.next_expires_on.split('-').reverse().join('/') : '',
      r.next_expiry_status ? EXPIRY_STATUS_LABEL[r.next_expiry_status] : '',
      r.is_active ? 'Sí' : 'No',
    ]
    // Las celdas armadas a propósito como fórmula de texto (="000123") no se escapan.
    lines.push(cells.map((c, i) => (i < 2 ? String(c ?? '') : csvCell(c))).join(';'))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Descarga un texto como archivo en el navegador. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
