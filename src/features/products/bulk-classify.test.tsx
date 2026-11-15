import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const UNCLASSIFIED = 'cccccccc-0000-4000-8000-000000000001'
const DAIRY = 'cccccccc-0000-4000-8000-000000000002'
const BRAND_X = 'bbbbbbbb-0000-4000-8000-000000000001'

function row(id: string, name: string) {
  return {
    id,
    sku: id.slice(-6),
    barcode: null,
    name,
    category_id: UNCLASSIFIED,
    category_name: 'Sin clasificar',
    brand_id: 'b0',
    brand_name: 'Sin clasificar',
    supplier_id: null,
    supplier_name: null,
    sale_unit: 'unit',
    cost_price: 1,
    sale_price: 1,
    sale_price_with_vat: 1.21,
    vat_rate: 21,
    boxes_quantity: 0,
    units_per_box: 12,
    min_stock: 0,
    is_active: true,
    stock_quantity: 0,
    next_expires_on: null,
    next_expiry_status: null,
    active_batches_count: 0,
    is_low_stock: true,
    units_in_boxes: 0,
    loose_units: 0,
    has_box_mismatch: false,
    legacy_code: null,
  }
}

function setup(role: 'manager' | 'staff', path = '/productos?q=leche') {
  const fake = createFakeSupabase(fakeSession(), { role })
  const rows = [row('00000000-0000-4000-8000-000000000011', 'Leche A'), row('00000000-0000-4000-8000-000000000012', 'Leche B')]
  fake.setTable('v_product_list', rows)
  fake.setTable(
    'products',
    rows.map((r) => ({ id: r.id, category_id: UNCLASSIFIED, brand_id: 'b0' })),
  )
  fake.setTable('categories', [
    { id: UNCLASSIFIED, name: 'Sin clasificar', is_active: true },
    { id: DAIRY, name: 'Lácteos', is_active: true },
  ])
  fake.setTable('brands', [{ id: BRAND_X, name: 'Marca X', is_active: true }])
  fake.setTable('suppliers', [])
  renderApp(path, fake.client)
  return { fake, user: userEvent.setup() }
}

describe('clasificar en lote', () => {
  it('cambia la categoría de todos los productos del filtro', async () => {
    const { user, fake } = setup('manager')
    await user.click(await screen.findByRole('button', { name: 'Clasificar los 2 del listado' }))
    const dialog = screen.getByRole('dialog', { name: 'Clasificar productos del listado' })
    expect(dialog).toHaveTextContent('Se cambian los 2 productos que muestra el listado')
    await user.selectOptions(within(dialog).getByLabelText(/^Nueva categoría/), DAIRY)
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar a 2 productos' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toEqual({
      table: 'products',
      op: 'update',
      payload: { category_id: DAIRY },
      filters: { id: ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012'] },
    })
    expect(await screen.findByText('Se actualizaron 2 productos.')).toBeInTheDocument()
  })

  it('pide elegir algo antes de aplicar', async () => {
    const { user, fake } = setup('manager')
    await user.click(await screen.findByRole('button', { name: 'Clasificar los 2 del listado' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar a 2 productos' }))
    expect(within(dialog).getByText('Elegí una categoría, una marca o las dos.')).toBeInTheDocument()
    expect(fake.writes).toHaveLength(0)
  })

  it('sin filtro advierte que cambiaría todo', async () => {
    const { user } = setup('manager', '/productos')
    await user.click(await screen.findByRole('button', { name: 'Clasificar los 2 del listado' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('No hay ningún filtro')
  })

  it('el empleado no ve la opción', async () => {
    setup('staff')
    await screen.findByRole('table', { name: 'Listado de productos' })
    expect(screen.queryByRole('button', { name: /Clasificar/ })).not.toBeInTheDocument()
  })
})
