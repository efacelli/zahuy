import { describe, expect, it } from 'vitest'
import { toCreateProductParams } from './api'
import { priceWithVatPreview } from '../../domain/vat'
import { emptyProductForm, productFormSchema, productFormWarnings, type ProductFormValues } from './product-form-schema'

const TODAY = '2026-11-14'
const CAT = '11111111-1111-4111-8111-111111111111'
const BRAND = '22222222-2222-4222-8222-222222222222'

function valid(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    ...emptyProductForm(TODAY),
    name: 'Yogur de frutilla 190 g',
    category_id: CAT,
    brand_id: BRAND,
    cost_price: '450,50',
    sale_price: '700',
    ...overrides,
  }
}

function errorsOf(values: ProductFormValues): Record<string, string> {
  const result = productFormSchema(TODAY).safeParse(values)
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]))
}

describe('productFormSchema', () => {
  it('acepta un producto mínimo y normaliza los datos', () => {
    const result = productFormSchema(TODAY).parse(valid({ name: '  Yogur de frutilla 190 g ', description: '  ', barcode: '' }))
    expect(result).not.toHaveProperty('sku')
    expect(result).toMatchObject({
      name: 'Yogur de frutilla 190 g',
      barcode: null,
      description: null,
      supplier_id: null,
      cost_price: 450.5,
      sale_price: 700,
      vat_rate: 21,
      boxes_quantity: 0,
      units_per_box: 12,
      min_stock: 0,
      is_active: true,
      initial_stock: null,
    })
  })

  it('exige nombre, categoría, marca y precios; el SKU lo asigna la base (v0.4.0)', () => {
    const e = errorsOf({ ...emptyProductForm(TODAY) })
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['name', 'category_id', 'brand_id', 'cost_price', 'sale_price']))
    expect(e).not.toHaveProperty('sku')
  })

  it('el proveedor es opcional', () => {
    expect(errorsOf(valid({ supplier_id: '' }))).toEqual({})
  })

  it('unidades por caja: entero mayor que cero, 12 por defecto', () => {
    expect(productFormSchema(TODAY).parse(valid({ units_per_box: '24' })).units_per_box).toBe(24)
    expect(errorsOf(valid({ units_per_box: '0' })).units_per_box).toBeDefined()
    expect(errorsOf(valid({ units_per_box: '1,5' })).units_per_box).toBeDefined()
    expect(errorsOf(valid({ units_per_box: '' })).units_per_box).toBeDefined()
  })

  it('valida el formato del código de barras', () => {
    expect(errorsOf(valid({ barcode: '7790001234567' }))).toEqual({})
    expect(errorsOf(valid({ barcode: '1234' })).barcode).toBeDefined()
    expect(errorsOf(valid({ barcode: '77900012345AB' })).barcode).toBeDefined()
  })

  it('acepta coma o punto decimal y rechaza separador de miles', () => {
    expect(errorsOf(valid({ cost_price: '1250.75' }))).toEqual({})
    expect(errorsOf(valid({ cost_price: '1.250,75' })).cost_price).toBeDefined()
    expect(errorsOf(valid({ cost_price: '10,123' })).cost_price).toMatch(/2 decimales/)
    expect(errorsOf(valid({ cost_price: '-5' })).cost_price).toBeDefined()
  })

  it('el precio sin IVA admite 4 decimales para que el precio final sea exacto (P-24)', () => {
    expect(errorsOf(valid({ sale_price: '991,7355' }))).toEqual({})
    expect(productFormSchema(TODAY).parse(valid({ sale_price: '991,7355' })).sale_price).toBe(991.7355)
    expect(errorsOf(valid({ sale_price: '1,23456' })).sale_price).toMatch(/4 decimales/)
  })

  it('solo admite IVA 21% o 10,5%', () => {
    expect(productFormSchema(TODAY).parse(valid({ vat_rate: '10.5' })).vat_rate).toBe(10.5)
    expect(errorsOf(valid({ vat_rate: '27' })).vat_rate).toBeDefined()
  })

  it('las cajas son un entero independiente', () => {
    expect(productFormSchema(TODAY).parse(valid({ boxes_quantity: '5' })).boxes_quantity).toBe(5)
    expect(errorsOf(valid({ boxes_quantity: '1,5' })).boxes_quantity).toBeDefined()
  })

  describe('stock inicial', () => {
    it('sin cantidad no crea lote aunque haya fechas', () => {
      const result = productFormSchema(TODAY).parse(valid({ initial_quantity: '', expires_on: '2026-12-15' }))
      expect(result.initial_stock).toBeNull()
    })

    it('con cantidad arma el lote', () => {
      const result = productFormSchema(TODAY).parse(
        valid({ initial_quantity: '30', expires_on: '2026-12-15', batch_number: ' L-01 ' }),
      )
      expect(result.initial_stock).toEqual({
        quantity: 30,
        received_on: TODAY,
        expires_on: '2026-12-15',
        batch_number: 'L-01',
      })
    })

    it('con stock, el vencimiento es obligatorio (v0.4.0)', () => {
      expect(errorsOf(valid({ initial_quantity: '10', expires_on: '' })).expires_on).toBe('Indicá la fecha de vencimiento.')
    })

    it('rechaza cero, negativos y decimales en unidades enteras', () => {
      expect(errorsOf(valid({ initial_quantity: '0' })).initial_quantity).toBeDefined()
      expect(errorsOf(valid({ initial_quantity: '-3' })).initial_quantity).toBeDefined()
      expect(errorsOf(valid({ initial_quantity: '1,5', sale_unit: 'unit' })).initial_quantity).toMatch(/entera/)
      expect(errorsOf(valid({ initial_quantity: '1,5', sale_unit: 'box' })).initial_quantity).toMatch(/entera/)
    })

    it('admite decimales en kilo', () => {
      expect(productFormSchema(TODAY).parse(valid({ initial_quantity: '2,345', sale_unit: 'kg', expires_on: '2026-12-01' })).initial_stock?.quantity).toBe(
        2.345,
      )
    })

    it('no admite fecha de ingreso futura', () => {
      expect(errorsOf(valid({ initial_quantity: '5', received_on: '2026-11-15' })).received_on).toBeDefined()
    })
  })
})

describe('productFormWarnings', () => {
  it('avisa precio menor al costo, vencimiento anterior al ingreso y lote vencido', () => {
    const warnings = productFormWarnings(
      valid({ cost_price: '800', sale_price: '700', initial_quantity: '5', received_on: TODAY, expires_on: '2026-11-01' }),
      TODAY,
    )
    expect(warnings).toEqual([
      'El precio de venta es menor que el costo.',
      'La fecha de vencimiento es anterior a la de ingreso.',
      'El lote ya está vencido.',
    ])
  })

  it('sin problemas no avisa nada', () => {
    expect(productFormWarnings(valid(), TODAY)).toEqual([])
  })
})

describe('toCreateProductParams', () => {
  it('usa los nombres exactos de la RPC del contrato (§8.4)', () => {
    const output = productFormSchema(TODAY).parse(valid({ initial_quantity: '30', expires_on: '2026-12-15' }))
    expect(toCreateProductParams(output, 'clave-1')).toEqual({
      p_idempotency_key: 'clave-1',
      p_name: 'Yogur de frutilla 190 g',
      p_category_id: CAT,
      p_brand_id: BRAND,
      p_sale_unit: 'unit',
      p_cost_price: 450.5,
      p_sale_price: 700,
      p_vat_rate: 21,
      p_barcode: null,
      p_description: null,
      p_supplier_id: null,
      p_boxes_quantity: 0,
      p_units_per_box: 12,
      p_min_stock: 0,
      p_is_active: true,
      p_image_path: null,
      p_initial_quantity: 30,
      p_received_on: TODAY,
      p_expires_on: '2026-12-15',
      p_batch_number: null,
    })
  })
})

describe('priceWithVatPreview (contrato v0.4.0 §12)', () => {
  it('coincide con round(sale_price * (1 + vat / 100), 2)', () => {
    expect(priceWithVatPreview(1000, 21)).toBe(1210)
    expect(priceWithVatPreview(1000, 10.5)).toBe(1105)
    expect(priceWithVatPreview(450.5, 21)).toBe(545.11)
    expect(priceWithVatPreview(0.01, 10.5)).toBe(0.01)
  })
})
