import type { SupabaseClient } from '@supabase/supabase-js'
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
