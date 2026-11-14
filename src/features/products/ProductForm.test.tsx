import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const CAT = '11111111-1111-4111-8111-111111111111'
const BRAND = '22222222-2222-4222-8222-222222222222'

function setup() {
  const fake = createFakeSupabase(fakeSession())
  fake.setTable('categories', [{ id: CAT, name: 'Lácteos' }])
  fake.setTable('brands', [{ id: BRAND, name: 'La Serenísima' }])
  fake.setTable('suppliers', [])
  const router = renderApp('/productos/nuevo', fake.client)
  return { fake, router, user: userEvent.setup() }
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^SKU/), 'YOG-FRU-1')
  await user.type(screen.getByLabelText(/^Nombre/), 'Yogur de frutilla')
  await user.selectOptions(await screen.findByLabelText(/^Categoría/), 'Lácteos')
  await user.selectOptions(await screen.findByLabelText(/^Marca/), 'La Serenísima')
  await user.type(screen.getByLabelText(/^Precio de costo/), '450,50')
  await user.type(screen.getByLabelText(/^Precio de venta/), '700')
}

describe('Nuevo producto', () => {
  it('se llega desde Productos', async () => {
    const fake = createFakeSupabase(fakeSession())
    const router = renderApp('/productos', fake.client)
    await userEvent.setup().click(await screen.findByRole('link', { name: /Nuevo producto/ }))
    expect(router.state.location.pathname).toBe('/productos/nuevo')
  })

  it('muestra los errores de los campos obligatorios', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByText('Ingresá el SKU.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá el nombre.')).toBeInTheDocument()
    expect(screen.getByText('Elegí una categoría.')).toBeInTheDocument()
    expect(screen.getByText('Elegí una marca.')).toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('sin stock inicial guarda directo y vuelve al listado', async () => {
    const { user, fake, router } = setup()
    fake.setRpcResult('create_product', { id: 'p1', sku: 'YOG-FRU-1', name: 'Yogur de frutilla' })
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/productos'))
    expect(fake.rpc).toHaveBeenCalledOnce()
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('create_product')
    expect(params).toMatchObject({ p_sku: 'YOG-FRU-1', p_cost_price: 450.5, p_initial_quantity: null })
    expect(params.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText(/Se creó "Yogur de frutilla"/)).toBeInTheDocument()
  })

  it('con stock inicial pide confirmación antes de guardar', async () => {
    const { user, fake } = setup()
    fake.setRpcResult('create_product', { id: 'p1', sku: 'YOG-FRU-1', name: 'Yogur de frutilla' })
    await fillRequired(user)
    await user.type(screen.getByLabelText(/^Cantidad \(/), '30')
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirmar alta con stock' })
    expect(within(dialog).getByText('30 u.')).toBeInTheDocument()
    expect(within(dialog).getByText('Sin vencimiento')).toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Crear producto e ingresar stock' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    expect((fake.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ p_initial_quantity: 30 })
  })

  it('si el backend todavía no tiene la función, lo dice claramente y no pierde los datos', async () => {
    const { user } = setup()
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('todavía no está disponible en el servidor')
    expect(screen.getByLabelText(/^SKU/)).toHaveValue('YOG-FRU-1')
  })

  it('reintentar usa la misma clave de idempotencia', async () => {
    const { user, fake } = setup()
    fake.setRpcResult('create_product', null, { message: 'TypeError: Failed to fetch', code: '' })
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar')

    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledTimes(2))
    const keys = fake.rpc.mock.calls.map((c) => (c[1] as { p_idempotency_key: string }).p_idempotency_key)
    expect(keys[0]).toBe(keys[1])
  })

  it('muestra el SKU duplicado', async () => {
    const { user, fake } = setup()
    fake.setRpcResult('create_product', null, { code: 'P0001', message: 'SKU_ALREADY_EXISTS' })
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un producto con ese SKU.')
  })

  it('si no se pueden cargar las categorías, lo avisa y permite reintentar', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('categories', null, { code: 'PGRST205', message: 'Could not find the table' })
    renderApp('/productos/nuevo', fake.client)
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Categoría/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('avisa si el precio es menor al costo, sin bloquear', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText(/^Precio de costo/), '800')
    await user.type(screen.getByLabelText(/^Precio de venta/), '700')
    expect(await screen.findByText('El precio de venta es menor que el costo.')).toBeInTheDocument()
  })
})
