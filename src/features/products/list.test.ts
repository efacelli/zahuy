import { describe, expect, it } from 'vitest'
import { daysLabel } from '../../domain/expiry'
import { applyListParams, type ListQuery } from './list-api'
import {
  DEFAULT_LIST_PARAMS,
  NO_SUPPLIER,
  hasActiveFilters,
  parseListParams,
  sanitizeSearch,
  serializeListParams,
  type ProductListParams,
} from './list-params'

const CAT = '11111111-1111-4111-8111-111111111111'
const SUP = '33333333-3333-4333-8333-333333333331'

describe('parámetros del listado en la URL', () => {
  it('sin parámetros usa los valores por defecto', () => {
    expect(parseListParams(new URLSearchParams())).toEqual(DEFAULT_LIST_PARAMS)
  })

  it('lee y vuelve a escribir los mismos filtros', () => {
    const url = new URLSearchParams(
      `q=yogur&categoria=${CAT}&proveedor=${SUP}&stock=bajo&vence=urgente&estado=todos&orden=stock_quantity&dir=desc&pagina=3`,
    )
    const params = parseListParams(url)
    expect(params).toMatchObject({
      search: 'yogur',
      categoryId: CAT,
      supplierId: SUP,
      lowStock: true,
      expiry: 'urgente',
      status: 'todos',
      sort: 'stock_quantity',
      direction: 'desc',
      page: 3,
    })
    expect(serializeListParams(params).toString()).toBe(url.toString())
  })

  it('ignora valores inválidos (URL manipulada)', () => {
    const params = parseListParams(
      new URLSearchParams('categoria=no-es-uuid&orden=password&dir=x&pagina=-2&vence=mañana&estado=borrados'),
    )
    expect(params).toEqual(DEFAULT_LIST_PARAMS)
  })

  it('acepta "sin proveedor"', () => {
    expect(parseListParams(new URLSearchParams(`proveedor=${NO_SUPPLIER}`)).supplierId).toBe(NO_SUPPLIER)
  })

  it('la URL por defecto queda vacía', () => {
    expect(serializeListParams(DEFAULT_LIST_PARAMS).toString()).toBe('')
    expect(hasActiveFilters(DEFAULT_LIST_PARAMS)).toBe(false)
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, lowStock: true })).toBe(true)
  })
})

describe('sanitizeSearch', () => {
  it('quita caracteres especiales de PostgREST y LIKE', () => {
    expect(sanitizeSearch('  yogur, (frutilla)%_*  ')).toBe('yogur frutilla')
    expect(sanitizeSearch('name.eq.1')).toBe('name eq 1')
    expect(sanitizeSearch('x'.repeat(200))).toHaveLength(100)
  })
})

/** Builder que solo registra las llamadas, para verificar la consulta exacta. */
function recorder() {
  const calls: [string, ...unknown[]][] = []
  const q: ListQuery = {
    or: (f) => (calls.push(['or', f]), q),
    eq: (c, v) => (calls.push(['eq', c, v]), q),
    is: (c, v) => (calls.push(['is', c, v]), q),
    in: (c, v) => (calls.push(['in', c, v]), q),
    order: (c, o) => (calls.push(['order', c, o]), q),
    range: (f, t) => (calls.push(['range', f, t]), Promise.resolve({ data: [], error: null, count: 0 })),
  }
  return { q, calls }
}

function run(p: Partial<ProductListParams>) {
  const { q, calls } = recorder()
  void applyListParams(q, { ...DEFAULT_LIST_PARAMS, ...p })
  return calls
}

describe('consulta a v_product_list', () => {
  it('por defecto: solo activos, orden por nombre y primera página', () => {
    expect(run({})).toEqual([
      ['eq', 'is_active', true],
      ['order', 'name', { ascending: true, nullsFirst: false }],
      ['order', 'id', { ascending: true }],
      ['range', 0, 24],
    ])
  })

  it('busca por nombre, SKU o código de barras', () => {
    expect(run({ search: 'yogur' })).toContainEqual(['or', 'name.ilike.%yogur%,sku.ilike.%yogur%,barcode.ilike.%yogur%'])
  })

  it('no inyecta filtros con la búsqueda', () => {
    const or = run({ search: 'x,is_active.eq.false' }).find((c) => c[0] === 'or')
    expect(or?.[1]).toBe('name.ilike.%x is active eq false%,sku.ilike.%x is active eq false%,barcode.ilike.%x is active eq false%')
    expect(run({ search: 'x,is_active.eq.false' }).filter((c) => c[1] === 'is_active')).toEqual([['eq', 'is_active', true]])
  })

  it('filtra por categoría, proveedor, stock bajo y vencimiento', () => {
    const calls = run({ categoryId: CAT, supplierId: SUP, lowStock: true, expiry: 'por_vencer', status: 'todos' })
    expect(calls).toContainEqual(['eq', 'category_id', CAT])
    expect(calls).toContainEqual(['eq', 'supplier_id', SUP])
    expect(calls).toContainEqual(['eq', 'is_low_stock', true])
    expect(calls).toContainEqual(['in', 'next_expiry_status', ['expires_urgent', 'expires_soon', 'expires_upcoming']])
    expect(calls.some((c) => c[1] === 'is_active')).toBe(false)
  })

  it('"sin proveedor" busca proveedor vacío', () => {
    expect(run({ supplierId: NO_SUPPLIER })).toContainEqual(['is', 'supplier_id', null])
  })

  it('vencidos y urgentes', () => {
    expect(run({ expiry: 'vencido' })).toContainEqual(['in', 'next_expiry_status', ['expired']])
    expect(run({ expiry: 'urgente' })).toContainEqual(['in', 'next_expiry_status', ['expires_urgent']])
  })

  it('ordena por la columna pedida con desempate estable y pagina', () => {
    const calls = run({ sort: 'stock_quantity', direction: 'desc', page: 3 })
    expect(calls.filter((c) => c[0] === 'order')).toEqual([
      ['order', 'stock_quantity', { ascending: false, nullsFirst: false }],
      ['order', 'name', { ascending: true }],
      ['order', 'id', { ascending: true }],
    ])
    expect(calls.at(-1)).toEqual(['range', 50, 74])
  })
})

describe('daysLabel', () => {
  it('contador de días', () => {
    expect(daysLabel(0)).toBe('vence hoy')
    expect(daysLabel(1)).toBe('vence mañana')
    expect(daysLabel(12)).toBe('vence en 12 días')
    expect(daysLabel(-1)).toBe('venció ayer')
    expect(daysLabel(-4)).toBe('venció hace 4 días')
  })
})
