import { describe, expect, it, vi } from 'vitest'
import { toAppError } from '../../lib/errors'
import { fetchWeighedProducts } from '../pos/pos-api'
import { fetchEditableProduct, toCreateProductParams, toUpdateProductPayload } from './api'
import { textSearchFilter } from './list-params'
import { emptyProductForm, productFormSchema, productToFormValues, type ProductFormValues } from './product-form-schema'

/** PLU de balanza en productos (contrato §21): reglas del formulario, qué se envía a la base y búsqueda. */

const base = (over: Partial<ProductFormValues> = {}): ProductFormValues => ({
  ...emptyProductForm('2026-11-17'),
  name: 'Jamón cocido',
  category_id: '11111111-1111-4111-8111-111111111111',
  brand_id: '22222222-2222-4222-8222-222222222222',
  cost_price: '100',
  sale_price: '200',
  sale_unit: 'kg',
  ...over,
})

const parse = (over: Partial<ProductFormValues>) => productFormSchema('2026-11-17').safeParse(base(over))
const pluError = (over: Partial<ProductFormValues>) => {
  const r = parse(over)
  return r.success ? null : (r.error.issues.find((i) => i.path[0] === 'scale_plu')?.message ?? null)
}

describe('PLU de balanza: formulario', () => {
  it('sin PLU queda en null (todo lo anterior sigue igual)', () => {
    const r = parse({ scale_plu: '' })
    expect(r.success && r.data.scale_plu).toBeNull()
    expect(parse({ scale_plu: '   ' }).success).toBe(true)
  })

  it('se completa con ceros a la izquierda hasta 5 dígitos', () => {
    for (const [typed, saved] of [['5', '00005'], ['00005', '00005'], ['123', '00123'], ['12345', '12345'], [' 7 ', '00007']] as const) {
      const r = parse({ scale_plu: typed })
      expect(r.success && r.data.scale_plu).toBe(saved)
    }
  })

  it('rechaza lo que no es un PLU válido', () => {
    expect(pluError({ scale_plu: '123456' })).toMatch(/hasta 5 dígitos/)
    expect(pluError({ scale_plu: '0000a' })).toMatch(/hasta 5 dígitos/)
    expect(pluError({ scale_plu: '-5' })).toMatch(/hasta 5 dígitos/)
    expect(pluError({ scale_plu: '5,5' })).toMatch(/hasta 5 dígitos/)
    expect(pluError({ scale_plu: '0' })).toMatch(/00000/)
    expect(pluError({ scale_plu: '00000' })).toMatch(/00000/)
  })

  it('solo en productos por kilo', () => {
    expect(pluError({ scale_plu: '5', sale_unit: 'unit' })).toMatch(/solo va en productos por kilo/)
    expect(pluError({ scale_plu: '5', sale_unit: 'l' })).toMatch(/solo va en productos por kilo/)
    expect(pluError({ scale_plu: '5', sale_unit: 'kg' })).toBeNull()
    // Sin PLU, cualquier unidad.
    expect(pluError({ scale_plu: '', sale_unit: 'unit' })).toBeNull()
  })

  it('al editar, el PLU guardado vuelve al formulario con sus ceros', () => {
    const values = productToFormValues({
      barcode: null, scale_plu: '00005', name: 'Jamón', description: null, category_id: 'c', brand_id: 'b', supplier_id: null,
      sale_unit: 'kg', cost_price: 100, sale_price: 200, vat_rate: 21, boxes_quantity: 0, units_per_box: 12, min_stock: 0, is_active: true,
    })
    expect(values.scale_plu).toBe('00005')
    // Una base sin la columna no manda el campo: queda vacío.
    expect(productToFormValues({ barcode: null, name: 'Jamón', description: null, category_id: 'c', brand_id: 'b', supplier_id: null, sale_unit: 'kg', cost_price: 1, sale_price: 2, vat_rate: 21, boxes_quantity: 0, units_per_box: 12, min_stock: 0, is_active: true }).scale_plu).toBe('')
  })
})

describe('PLU de balanza: lo que se envía a la base', () => {
  const output = (scale_plu: string | null) => {
    const r = parse({ scale_plu: scale_plu ?? '' })
    if (!r.success) throw new Error('inválido')
    return r.data
  }

  it('alta: p_scale_plu solo viaja si hay PLU (una base sin la migración no conoce el parámetro)', () => {
    expect(toCreateProductParams(output(null), 'k')).not.toHaveProperty('p_scale_plu')
    expect(toCreateProductParams(output('5'), 'k')).toMatchObject({ p_scale_plu: '00005' })
  })

  it('edición: solo se manda scale_plu si hay PLU o si había uno (para quitarlo)', () => {
    expect(toUpdateProductPayload(output(null))).not.toHaveProperty('scale_plu')
    expect(toUpdateProductPayload(output('5'))).toMatchObject({ scale_plu: '00005' })
    expect(toUpdateProductPayload(output(null), true)).toMatchObject({ scale_plu: null })
  })
})

describe('PLU de balanza: búsqueda y errores', () => {
  it('escribir el PLU (1 a 5 dígitos) encuentra el producto, con o sin ceros', () => {
    expect(textSearchFilter('00005')).toContain(',scale_plu.eq.00005')
    expect(textSearchFilter('5')).toContain(',scale_plu.eq.00005')
    expect(textSearchFilter('12345')).toContain(',scale_plu.eq.12345')
  })

  it('no toca scale_plu en el resto de las búsquedas', () => {
    expect(textSearchFilter('queso')).not.toContain('scale_plu')
    expect(textSearchFilter('000123')).not.toContain('scale_plu') // SKU de 6 dígitos
    expect(textSearchFilter('7790000000017')).not.toContain('scale_plu') // código de barras
  })

  it('PLU repetido: mensaje claro en español', () => {
    const e = toAppError({ code: '23505', message: 'duplicate key value violates unique constraint "products_scale_plu_key"' })
    expect(e.message).toBe('Ese PLU ya es de otro producto.')
  })
})

describe('PLU de balanza: bases sin la columna', () => {
  /** Cliente mínimo: pedir `scale_plu` falla con 42703 (la base no tiene la migración); sin pedirlo, devuelve los productos. */
  const clientWithoutColumn = (rows: Record<string, unknown>[]) => {
    const asked: string[] = []
    const builder = (columns: string) => {
      asked.push(columns)
      const result = columns.includes('scale_plu')
        ? { data: null, error: { code: '42703', message: 'column products.scale_plu does not exist' } }
        : { data: rows, error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['eq', 'order', 'limit']) b[m] = () => b
      b.single = () => Promise.resolve({ data: rows[0] ?? null, error: result.error })
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return b
    }
    return { asked, client: { from: vi.fn(() => ({ select: builder })) } as never }
  }

  it('la caja pide los productos por kilo sin PLU y sigue funcionando (se elige a mano)', async () => {
    const { asked, client } = clientWithoutColumn([{ id: 'p1', sku: '000003', name: 'Queso', sale_unit: 'kg', sale_price_with_vat: '9000', is_active: true }])
    const products = await fetchWeighedProducts(client)
    expect(products).toEqual([{ id: 'p1', sku: '000003', name: 'Queso', sale_unit: 'kg', sale_price_with_vat: 9000, scale_plu: null }])
    expect(asked).toHaveLength(2)
    expect(asked[0]).toContain('scale_plu')
    expect(asked[1]).not.toContain('scale_plu')
  })

  it('la edición de un producto pide los datos sin PLU y el formulario lo oculta', async () => {
    const { client } = clientWithoutColumn([{ id: 'p1', sku: '000003', name: 'Queso', sale_unit: 'kg' }])
    const row = await fetchEditableProduct(client, 'p1')
    expect(row.name).toBe('Queso')
    expect(row.scale_plu).toBeUndefined()
  })
})
