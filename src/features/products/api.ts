import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from '../../lib/errors'
import type { SaleUnit } from '../../domain/units'
import { toAppError } from '../../lib/errors'
import type { ProductFormOutput } from './product-form-schema'

/**
 * Acceso a datos de productos y catálogos (contrato §5 y §8.4).
 * Cuando el backend publique los tipos generados, estas firmas pasan a usar
 * `Database` y el compilador avisa si algo no coincide con el esquema.
 */

export interface CatalogOption {
  id: string
  name: string
}

export type CatalogTable = 'categories' | 'brands' | 'suppliers'

export async function fetchCatalogOptions(client: SupabaseClient, table: CatalogTable): Promise<CatalogOption[]> {
  const { data, error } = await client.from(table).select('id, name').eq('is_active', true).order('name')
  if (error) throw error
  return (data ?? []) as CatalogOption[]
}

/**
 * Parámetros de la RPC `create_product`, con los nombres exactos del contrato v0.4.0 (§8.4).
 * Sin `p_sku`: el SKU lo genera la base y vuelve en la respuesta.
 */
export interface CreateProductParams {
  p_idempotency_key: string
  p_name: string
  p_category_id: string
  p_brand_id: string
  p_sale_unit: string
  p_cost_price: number
  p_sale_price: number
  p_vat_rate: number
  p_barcode: string | null
  /** Solo se envía si hay PLU: una base sin la migración de §21 no conoce el parámetro. */
  p_scale_plu?: string
  p_description: string | null
  p_supplier_id: string | null
  p_boxes_quantity: number
  p_units_per_box: number
  p_min_stock: number
  p_is_active: boolean
  p_image_path: string | null
  p_initial_quantity: number | null
  p_received_on: string | null
  p_expires_on: string | null
  p_batch_number: string | null
}

export function toCreateProductParams(values: ProductFormOutput, idempotencyKey: string): CreateProductParams {
  const stock = values.initial_stock
  return {
    p_idempotency_key: idempotencyKey,
    p_name: values.name,
    p_category_id: values.category_id,
    p_brand_id: values.brand_id,
    p_sale_unit: values.sale_unit,
    p_cost_price: values.cost_price,
    p_sale_price: values.sale_price,
    p_vat_rate: values.vat_rate,
    p_barcode: values.barcode,
    ...(values.scale_plu === null ? {} : { p_scale_plu: values.scale_plu }),
    p_description: values.description,
    p_supplier_id: values.supplier_id,
    p_boxes_quantity: values.boxes_quantity,
    p_units_per_box: values.units_per_box,
    p_min_stock: values.min_stock,
    p_is_active: values.is_active,
    p_image_path: null,
    p_initial_quantity: stock?.quantity ?? null,
    p_received_on: stock?.received_on ?? null,
    p_expires_on: stock?.expires_on ?? null,
    p_batch_number: stock?.batch_number ?? null,
  }
}

/** Columnas que la app puede editar en `products` (permisos por columna, §5.5 y §9). */
export interface ProductUpdatePayload {
  barcode: string | null
  /** Solo se envía si hay PLU o si había uno (para quitarlo): sin la migración de §21 la columna no existe. */
  scale_plu?: string | null
  name: string
  description: string | null
  category_id: string
  brand_id: string
  supplier_id: string | null
  sale_unit: string
  cost_price: number
  sale_price: number
  vat_rate: number
  boxes_quantity: number
  units_per_box: number
  min_stock: number
  is_active: boolean
}

export function toUpdateProductPayload(values: ProductFormOutput, hadScalePlu = false): ProductUpdatePayload {
  return {
    barcode: values.barcode,
    ...(values.scale_plu !== null || hadScalePlu ? { scale_plu: values.scale_plu } : {}),
    name: values.name,
    description: values.description,
    category_id: values.category_id,
    brand_id: values.brand_id,
    supplier_id: values.supplier_id,
    sale_unit: values.sale_unit,
    cost_price: values.cost_price,
    sale_price: values.sale_price,
    vat_rate: values.vat_rate,
    boxes_quantity: values.boxes_quantity,
    units_per_box: values.units_per_box,
    min_stock: values.min_stock,
    is_active: values.is_active,
  }
}

export async function updateProduct(
  client: SupabaseClient,
  id: string,
  payload: ProductUpdatePayload,
): Promise<CreatedProduct> {
  const { data, error } = await client.from('products').update(payload).eq('id', id).select('id, sku, name').single()
  if (error) throw updateError(error)
  return data as CreatedProduct
}

/** Cambia solo el conteo de cajas; lo puede hacer cualquier usuario activo (§9). */
export async function updateBoxCount(client: SupabaseClient, id: string, boxes: number): Promise<void> {
  const { error } = await client.from('products').update({ boxes_quantity: boxes }).eq('id', id).select('id').single()
  if (error) throw updateError(error)
}

/**
 * Un UPDATE que RLS no deja ver/tocar no falla: afecta 0 filas, y `.single()`
 * lo informa como PGRST116. Desde la app los productos no se borran, así que
 * 0 filas significa falta de permiso (o usuario desactivado).
 */
function updateError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'PGRST116' ? { code: '42501', message: 'UPDATE_NO_ROWS' } : error
}

/** Producto tal como se edita (tabla `products`, §5.5). */
export interface EditableProductRow {
  id: string
  sku: string
  barcode: string | null
  /** Ausente si la base todavía no tiene la columna (§21). */
  scale_plu?: string | null
  name: string
  description: string | null
  category_id: string
  brand_id: string
  supplier_id: string | null
  sale_unit: SaleUnit
  cost_price: number
  sale_price: number
  vat_rate: number
  boxes_quantity: number
  units_per_box: number
  min_stock: number
  is_active: boolean
}

const EDITABLE_COLUMNS =
  'id, sku, barcode, name, description, category_id, brand_id, supplier_id, sale_unit, cost_price, sale_price, vat_rate, boxes_quantity, units_per_box, min_stock, is_active'

export async function fetchEditableProduct(client: SupabaseClient, id: string): Promise<EditableProductRow> {
  // Con el PLU de balanza (§21); si la base todavía no tiene la columna, sin él (el formulario lo oculta).
  const withPlu = await client.from('products').select(`${EDITABLE_COLUMNS}, scale_plu`).eq('id', id).single()
  if (!withPlu.error) return withPlu.data as unknown as EditableProductRow
  if (!isMissingColumn(withPlu.error)) throw withPlu.error
  const { data, error } = await client.from('products').select(EDITABLE_COLUMNS).eq('id', id).single()
  if (error) throw error
  return data as unknown as EditableProductRow
}

/** Mensaje para errores del alta o la edición de productos. */
export function productErrorMessage(error: unknown, editing: boolean): string {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown }
  if (editing && e.code === '23514' && typeof e.message === 'string' && e.message.includes('sale_unit')) {
    return 'No se puede cambiar la unidad de venta: el producto ya tiene movimientos de stock.'
  }
  return toAppError(error).message
}

export interface CreatedProduct {
  id: string
  sku: string
  name: string
}

export async function createProduct(client: SupabaseClient, params: CreateProductParams): Promise<CreatedProduct> {
  const { data, error } = await client.rpc('create_product', params).single()
  if (error) throw error
  return data as CreatedProduct
}
