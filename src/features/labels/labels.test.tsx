import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { expandLabels, mergeItems, parseCopies, type LabelProduct } from './labels-api'

const ARCOR = '11111111-1111-4111-8111-111111111111'
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const product = (id: string, name: string, price: number, extra: Partial<LabelProduct> = {}): LabelProduct => ({
  id,
  sku: id === P1 ? '000001' : '000002',
  barcode: null,
  name,
  brand_name: 'Arcor',
  sale_unit: 'unit',
  sale_price_with_vat: price,
  ...extra,
})

function setup(role: 'manager' | 'staff' = 'manager') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('brands', [{ id: ARCOR, name: 'Arcor', is_active: true }])
  fake.setTable('categories', [])
  fake.setTable('price_bulk_changes', [
    {
      id: 'bulk-1',
      created_at: '2026-11-16T12:00:00Z',
      percent: 8,
      rounding_multiple: 10,
      products_count: 2,
      status: 'applied',
      reverted_at: null,
      revert_reason: null,
      notes: 'Lista Arcor',
    },
  ])
  fake.setTable('price_history', [
    { product_id: P1, bulk_change_id: 'bulk-1', old_sale_price: 1000, new_sale_price: 1080 },
    { product_id: P2, bulk_change_id: 'bulk-1', old_sale_price: 500, new_sale_price: 540 },
  ])
  // brand_id e is_active los usa el filtro de la consulta, no la etiqueta.
  fake.setTable('v_product_list', [
    { ...product(P1, 'Bon o Bon', 1306.8, { barcode: '7790580000001' }), brand_id: ARCOR, is_active: true },
    { ...product(P2, 'Queso cremoso', 9800, { sale_unit: 'kg' }), brand_id: ARCOR, is_active: true },
  ])
  renderApp('/etiquetas', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('lista de etiquetas', () => {
  it('no repite productos y respeta las copias', () => {
    const a = product(P1, 'A', 10)
    const b = product(P2, 'B', 20)
    const first = mergeItems([], [a])
    const second = mergeItems(first.items, [a, b])
    expect(second.added).toBe(1)
    expect(second.items).toHaveLength(2)
    expect(expandLabels([{ product: a, copies: 3 }, { product: b, copies: 1 }]).map((p) => p.id)).toEqual([P1, P1, P1, P2])
  })

  it('copias de 1 a 50', () => {
    expect(parseCopies('1')).toBe(1)
    expect(parseCopies('50')).toBe(50)
    expect(parseCopies('0')).toBeNull()
    expect(parseCopies('51')).toBeNull()
    expect(parseCopies('2,5')).toBeNull()
  })
})

describe('Etiquetas de góndola', () => {
  it('agrega los productos de un aumento y arma la hoja con precio final', async () => {
    const { fake, user } = setup()
    const bulk = await screen.findByLabelText(/^Productos de un aumento/)
    await within(bulk).findByRole('option', { name: /Lista Arcor/ })
    await user.selectOptions(bulk, 'bulk-1')
    await user.click(screen.getByRole('button', { name: 'Agregar sus productos' }))

    const list = await screen.findByRole('table', { name: 'Productos para etiquetar' })
    expect(within(list).getByText('Bon o Bon')).toBeInTheDocument()
    expect(screen.getByText('2 productos · 2 etiquetas · 1 hoja')).toBeInTheDocument()
    expect(fake.from.mock.calls.some((c) => c[0] === 'price_history')).toBe(true)

    const label = screen.getByRole('article', { name: 'Etiqueta de Bon o Bon' })
    expect(label).toHaveTextContent('1.306,80')
    expect(label).toHaveTextContent('7790580000001')
    // A granel: precio por kilo.
    expect(screen.getByRole('article', { name: 'Etiqueta de Queso cremoso' })).toHaveTextContent('por kg')

    await user.selectOptions(within(list).getByLabelText('Copias de Bon o Bon'), '3')
    expect(screen.getByText('2 productos · 4 etiquetas · 1 hoja')).toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: 'Etiqueta de Bon o Bon' })).toHaveLength(3)

    await user.click(within(list).getByRole('button', { name: 'Quitar Queso cremoso' }))
    expect(screen.getByText('1 producto · 3 etiquetas · 1 hoja')).toBeInTheDocument()
  })

  it('agrega una marca entera y no duplica al repetir', async () => {
    const { user } = setup()
    const brand = await screen.findByLabelText(/^Marca/)
    await within(brand).findByRole('option', { name: 'Arcor' })
    await user.selectOptions(brand, 'Arcor')
    await user.click(screen.getByRole('button', { name: 'Agregar la marca' }))
    expect(await screen.findByText('Se agregaron 2 productos.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar la marca' }))
    expect(await screen.findByText('Esos productos ya estaban en la lista.')).toBeInTheDocument()
  })

  it('la lista vacía no se puede imprimir', async () => {
    setup()
    expect(await screen.findByText('Lista vacía')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir etiquetas' })).toBeDisabled()
  })

  it('el empleado imprime etiquetas pero sin las opciones del historial de precios', async () => {
    const { fake } = setup('staff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Etiquetas de góndola' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Productos de un aumento/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Precios que cambiaron desde/)).not.toBeInTheDocument()
    await waitFor(() => expect(fake.from.mock.calls.some((c) => c[0] === 'price_bulk_changes')).toBe(false))
  })
})
