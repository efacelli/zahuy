import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { hasFilters, parsePercent } from './prices-api'

const ARCOR = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const row = (id: string, sku: string, name: string, oldPrice: number, newPrice: number) => ({
  product_id: id,
  sku,
  name,
  brand_name: 'Arcor',
  category_name: 'Golosinas',
  supplier_name: null,
  old_sale_price: oldPrice / 1.21,
  old_price_with_vat: oldPrice,
  new_sale_price: newPrice / 1.21,
  new_price_with_vat: newPrice,
  change_amount: newPrice - oldPrice,
})

function setup(role: 'manager' | 'staff' = 'manager') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('brands', [
    { id: ARCOR, name: 'Arcor', is_active: true },
    { id: OTHER, name: 'Vieja', is_active: false },
  ])
  fake.setTable('categories', [])
  fake.setTable('suppliers', [])
  fake.setTable('price_bulk_changes', [])
  renderApp('/precios', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('porcentaje del aumento', () => {
  it('acepta bajas, coma y hasta 50 %', () => {
    expect(parsePercent('8').value).toBe(8)
    expect(parsePercent('7,5').value).toBe(7.5)
    expect(parsePercent('-5').value).toBe(-5)
    expect(parsePercent('0').error).toMatch(/0/)
    expect(parsePercent('51').error).toMatch(/50/)
    expect(parsePercent('').error).toBeTruthy()
    expect(parsePercent('1,2345').error).toMatch(/decimales/)
  })

  it('sin ningún filtro no hay aumento (P-50)', () => {
    expect(hasFilters({ brandIds: [], supplierIds: [], categoryIds: [], productIds: [] })).toBe(false)
    expect(hasFilters({ brandIds: [], supplierIds: [], categoryIds: [], productIds: [P1] })).toBe(true)
  })
})

describe('Aumentos de precio', () => {
  it('vista previa por marca, excluye un producto y aplica lo que se vio', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('preview_price_increase', [
      row(P1, '000001', 'Bon o Bon', 500, 540),
      row(P2, '000002', 'Rocklets', 1000, 1080),
      row(P3, '000003', 'Chupetín', 100, 100),
    ])
    fake.setRpcResult('apply_price_increase', {
      id: 'bulk-1',
      created_at: '2026-11-16T12:00:00Z',
      percent: 8,
      rounding_multiple: 10,
      products_count: 1,
      status: 'applied',
      reverted_at: null,
      revert_reason: null,
      notes: null,
    })

    const brand = await screen.findByLabelText(/^Marca/)
    await within(brand).findByRole('option', { name: 'Arcor' })
    // Las marcas desactivadas no se ofrecen.
    expect(within(brand).queryByRole('option', { name: 'Vieja' })).not.toBeInTheDocument()
    await user.selectOptions(brand, 'Arcor')
    await user.type(screen.getByLabelText(/^Porcentaje/), '8')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))

    const table = await screen.findByRole('table', { name: 'Precios antes y después del aumento' })
    expect(within(table).getByText('Sin cambio')).toBeInTheDocument()
    expect(within(table).getByLabelText('Incluir Chupetín')).toBeDisabled()
    const [name, params] = fake.rpc.mock.calls.find((c) => c[0] === 'preview_price_increase') as [string, Record<string, unknown>]
    expect(name).toBe('preview_price_increase')
    expect(params).toEqual({
      p_brand_ids: [ARCOR],
      p_supplier_ids: null,
      p_category_ids: null,
      p_product_ids: null,
      p_percent: 8,
      p_rounding_multiple: 10,
    })
    expect(fake.rpcFilters.find((f) => f.name === 'preview_price_increase')?.filters).toContainEqual(['range', 0, 99])

    await user.click(within(table).getByLabelText('Incluir Rocklets'))
    await user.click(screen.getByRole('button', { name: 'Aplicar aumento' }))
    const dialog = await screen.findByRole('dialog', { name: 'Aplicar aumento de precios' })
    expect(dialog).toHaveTextContent('+8 % · marca Arcor')
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => expect(fake.rpc.mock.calls.some((c) => c[0] === 'apply_price_increase')).toBe(true))
    const apply = fake.rpc.mock.calls.find((c) => c[0] === 'apply_price_increase')![1] as Record<string, unknown>
    expect(apply).toMatchObject({
      p_brand_ids: [ARCOR],
      p_percent: 8,
      p_rounding_multiple: 10,
      p_excluded_product_ids: [P2],
      p_notes: null,
    })
    expect(apply.p_idempotency_key).toEqual(expect.any(String))
    expect(await screen.findByText('Listo: cambió el precio de 1 producto.')).toBeInTheDocument()
  })

  it('pide un filtro y un porcentaje válido antes de la vista previa', async () => {
    const { fake, user } = setup()
    await user.type(await screen.findByLabelText(/^Porcentaje/), '60')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByText('Elegí al menos una marca, categoría, proveedor o producto.')).toBeInTheDocument()
    expect(screen.getByText('Como máximo 50 % por vez.')).toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('sin la migración, avisa que no está habilitado', async () => {
    const { user } = setup()
    await screen.findByRole('option', { name: 'Arcor' })
    await user.selectOptions(screen.getByLabelText(/^Marca/), 'Arcor')
    await user.type(screen.getByLabelText(/^Porcentaje/), '5')
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByText('Los aumentos masivos todavía no están habilitados en la base.')).toBeInTheDocument()
  })

  it('deshacer pide motivo e informa lo restaurado y lo salteado', async () => {
    const { fake, user } = setup()
    fake.setTable('price_bulk_changes', [
      {
        id: 'bulk-1',
        created_at: '2026-11-16T12:00:00Z',
        percent: 8,
        rounding_multiple: 10,
        products_count: 3,
        status: 'applied',
        reverted_at: null,
        revert_reason: null,
        notes: 'Lista Arcor',
      },
    ])
    fake.setRpcResult('revert_price_change', { restored: 2, skipped_product_ids: [P3] })
    await user.click(await screen.findByRole('button', { name: /Deshacer el aumento/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Deshacer aumento' })
    await user.click(within(dialog).getByRole('button', { name: 'Deshacer aumento' }))
    expect(await within(dialog).findByText('Indicá por qué se deshace.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/^Motivo/), 'Me equivoqué de marca')
    await user.click(within(dialog).getByRole('button', { name: 'Deshacer aumento' }))
    await waitFor(() => expect(fake.rpc.mock.calls.some((c) => c[0] === 'revert_price_change')).toBe(true))
    expect(fake.rpc.mock.calls.find((c) => c[0] === 'revert_price_change')![1]).toMatchObject({
      p_bulk_change_id: 'bulk-1',
      p_reason: 'Me equivoqué de marca',
    })
    expect(
      await screen.findByText(
        'Se restauró el precio de 2 productos. 1 producto quedó como estaba porque su precio cambió después.',
      ),
    ).toBeInTheDocument()
  })

  it('el empleado no entra', async () => {
    setup('staff')
    expect(await screen.findByText(/No tenés permiso|no tenés acceso/i)).toBeInTheDocument()
  })
})
