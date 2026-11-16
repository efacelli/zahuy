import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

/** El foco se mueve después de que el buscador se vuelve a montar; con la suite en paralelo puede tardar más de 1 s. */
const SLOW = { timeout: 4000 }

const NO_CODE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sku: '000001',
  name: 'Yogur frutilla',
  sale_unit: 'unit',
  units_per_box: 12,
  is_active: true,
  barcode: null,
}
const WITH_CODE = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sku: '000002',
  name: 'Fideos tirabuzón',
  sale_unit: 'unit',
  units_per_box: 1,
  is_active: true,
  barcode: '7790000000017',
}

function setup(role: 'manager' | 'staff') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('products', [{ ...NO_CODE }, { ...WITH_CODE }])
  fake.setTable('v_product_stock', [
    { product_id: NO_CODE.id, stock_quantity: 0 },
    { product_id: WITH_CODE.id, stock_quantity: 5 },
  ])
  fake.setRpcResult('receive_stock', { id: 'm1' })
  renderApp('/inventario', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('carga de inventario', () => {
  it('escanear un producto con código lo elige y carga con Enter', async () => {
    const { fake, user } = setup('staff')
    await user.type(await screen.findByLabelText(/^Producto(?!s)/), '7790000000017{Enter}')
    expect(await screen.findByText(/Stock actual:/)).toHaveTextContent('5 u.')
    // El foco ya está en la cantidad: cantidad, Enter, vencimiento, Enter, Enter (Revisar), Enter (Confirmar).
    await waitFor(() => expect(screen.getByLabelText(/^Cantidad/)).toHaveFocus(), SLOW)
    await user.keyboard('24{Enter}')
    await waitFor(() => expect(screen.getByLabelText(/^Vencimiento/)).toHaveFocus(), SLOW)
    await user.type(screen.getByLabelText(/^Vencimiento/), '100327')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(fake.rpc).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Confirmar ingreso' }))

    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('receive_stock')
    expect(params).toMatchObject({ p_product_id: WITH_CODE.id, p_quantity: 24, p_expires_on: '2027-03-10', p_notes: 'Carga de inventario' })
    expect(await screen.findByRole('heading', { name: 'Cargados en esta sesión (1)' })).toBeInTheDocument()
    // Vuelve al buscador para el próximo producto.
    await waitFor(() => expect(screen.getByLabelText(/^Producto(?!s)/)).toHaveFocus(), SLOW)
    expect(screen.getByLabelText(/^Producto(?!s)/)).toHaveValue('')
  })

  it('un código desconocido se guarda en el producto que el encargado elige después', async () => {
    const { fake, user } = setup('manager')
    await user.type(await screen.findByLabelText(/^Producto(?!s)/), '7791234567898{Enter}')
    expect(await screen.findByText(/no está cargado en ningún producto/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Yogur frutilla/ }))
    expect(screen.getByLabelText(/^Código de barras/)).toHaveValue('7791234567898')

    await user.type(screen.getByLabelText(/^Cantidad/), '2')
    await user.click(screen.getByLabelText('Cajas'))
    await user.type(screen.getByLabelText(/^Vencimiento/), '31/01/2027')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(screen.getByText('7791234567898 (se guarda en el producto)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar ingreso' }))

    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    expect(fake.writes).toContainEqual(
      expect.objectContaining({ table: 'products', op: 'update', payload: { barcode: '7791234567898' }, filters: { id: NO_CODE.id } }),
    )
    expect((fake.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ p_quantity: 24 })
  })

  it('si el código ya es de otro producto, no carga el stock', async () => {
    const { fake, user } = setup('manager')
    fake.failNextWrite('products', { code: '23505', message: 'duplicate key value violates unique constraint "products_barcode_key"' })
    await user.click(await screen.findByRole('button', { name: /Yogur frutilla/ }))
    await user.type(screen.getByLabelText(/^Cantidad/), '6')
    await user.type(screen.getByLabelText(/^Vencimiento/), '31/01/2027')
    await user.type(screen.getByLabelText(/^Código de barras/), '7790000000017')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar ingreso' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un producto con ese código de barras.')
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('el empleado no ve el campo de código (editar productos es del encargado)', async () => {
    const { user } = setup('staff')
    await user.click(await screen.findByRole('button', { name: /Yogur frutilla/ }))
    expect(screen.getByText(/Sin código de barras/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Código de barras/)).not.toBeInTheDocument()
  })

  it('pide el vencimiento antes de confirmar', async () => {
    const { fake, user } = setup('staff')
    await user.click(await screen.findByRole('button', { name: /Fideos/ }))
    await user.type(screen.getByLabelText(/^Cantidad/), '3')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(screen.getByText('Indicá la fecha de vencimiento.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar ingreso' })).not.toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})
