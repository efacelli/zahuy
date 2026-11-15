import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const CAT = '11111111-1111-4111-8111-111111111111'
const BRAND = '22222222-2222-4222-8222-222222222222'

function setup() {
  const fake = createFakeSupabase(fakeSession())
  fake.setTable('categories', [
    { id: CAT, name: 'Lácteos', is_active: true },
    { id: '11111111-1111-4111-8111-999999999999', name: 'Categoría inactiva', is_active: false },
  ])
  fake.setTable('brands', [{ id: BRAND, name: 'La Serenísima', is_active: true }])
  fake.setTable('suppliers', [])
  const router = renderApp('/productos/nuevo', fake.client)
  return { fake, router, user: userEvent.setup() }
}

/** Elige una opción del autocompletado escribiendo parte del nombre. */
async function pick(user: ReturnType<typeof userEvent.setup>, label: RegExp, typed: string, option: string) {
  await user.type(await screen.findByRole('combobox', { name: label }), typed)
  await user.click(await screen.findByRole('option', { name: option }))
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^Nombre/), 'Yogur de frutilla')
  await pick(user, /^Categoría/, 'lac', 'Lácteos')
  await pick(user, /^Marca/, 'sere', 'La Serenísima')
  await user.type(screen.getByLabelText(/^Costo/), '450,50')
  await user.type(screen.getByLabelText(/^Precio de venta/), '700')
}

describe('Nuevo producto', () => {
  it('se llega desde Productos', async () => {
    const fake = createFakeSupabase(fakeSession())
    const router = renderApp('/productos', fake.client)
    await userEvent.setup().click(await screen.findByRole('link', { name: /Nuevo producto/ }))
    expect(router.state.location.pathname).toBe('/productos/nuevo')
  })

  it('solo ofrece categorías activas', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('combobox', { name: /^Categoría/ }))
    const list = await screen.findByRole('listbox', { name: 'Opciones de categoría' })
    expect(within(list).getByRole('option', { name: 'Lácteos' })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: 'Categoría inactiva' })).not.toBeInTheDocument()
  })

  it('muestra los errores de los campos obligatorios', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByText('Ingresá el nombre.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^SKU/)).not.toBeInTheDocument()
    expect(screen.getByText('Elegí una categoría.')).toBeInTheDocument()
    expect(screen.getByText('Elegí una marca.')).toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('sin stock inicial guarda directo y vuelve al listado', async () => {
    const { user, fake, router } = setup()
    fake.setRpcResult('create_product', { id: 'p1', sku: '000001', name: 'Yogur de frutilla' })
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/productos'))
    expect(fake.rpc).toHaveBeenCalledOnce()
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('create_product')
    expect(params).toMatchObject({ p_name: 'Yogur de frutilla', p_cost_price: 450.5, p_units_per_box: 12, p_initial_quantity: null })
    expect(params).not.toHaveProperty('p_sku')
    expect(params.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText('Se creó "Yogur de frutilla" (SKU 000001).')).toBeInTheDocument()
  })

  it('con stock inicial pide confirmación antes de guardar', async () => {
    const { user, fake } = setup()
    fake.setRpcResult('create_product', { id: 'p1', sku: '000001', name: 'Yogur de frutilla' })
    await fillRequired(user)
    await user.type(screen.getByLabelText(/^Cantidad inicial/), '30')
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))
    // Sin vencimiento no deja seguir (v0.4.0).
    expect(await screen.findByText('Indicá la fecha de vencimiento.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Vencimiento/), '2026-12-15')
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirmar alta con stock' })
    expect(within(dialog).getByText('30 u.')).toBeInTheDocument()
    expect(within(dialog).getByText('15/12/2026')).toBeInTheDocument()
    expect(within(dialog).getByText(/847,00/)).toBeInTheDocument()
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
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Yogur de frutilla')
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

  it('muestra el código de barras duplicado', async () => {
    const { user, fake } = setup()
    fake.setRpcResult('create_product', null, {
      code: '23505',
      message: 'duplicate key value violates unique constraint "products_barcode_key"',
    })
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un producto con ese código de barras.')
  })

  it('muestra la vista previa del precio final con IVA', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText(/^Precio de venta/), '1000')
    expect(screen.getByText(/1\.210,00/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/^IVA/), '10.5')
    expect(screen.getByText(/1\.105,00/)).toBeInTheDocument()
  })

  it('si no se pueden cargar las categorías, lo avisa y permite reintentar', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('categories', null, { code: 'PGRST205', message: 'Could not find the table' })
    renderApp('/productos/nuevo', fake.client)
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /^Categoría/ })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Reintentar' }).length).toBeGreaterThan(0)
  })

  it('autocompleta: "ar" muestra primero las que empiezan así', async () => {
    const { user, fake } = setup()
    fake.setTable('brands', [
      { id: 'b1', name: 'Arcor', is_active: true },
      { id: 'b2', name: 'Bon o Bon Arcor', is_active: true },
      { id: 'b3', name: 'Ilolay', is_active: true },
    ])
    await user.type(await screen.findByRole('combobox', { name: /^Marca/ }), 'ar')
    const list = await screen.findByRole('listbox', { name: 'Opciones de marca' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Arcor',
      'Bon o Bon Arcor',
      '+ Crear marca "ar"',
    ])
    // Enter elige sin enviar el formulario.
    await user.keyboard('{Enter}')
    expect(screen.getByRole('combobox', { name: /^Marca/ })).toHaveValue('Arcor')
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('crea una marca nueva desde el formulario si no existe', async () => {
    const { user, fake } = setup()
    await user.type(await screen.findByRole('combobox', { name: /^Marca/ }), 'Tía Maruca')
    await user.click(await screen.findByRole('option', { name: '+ Crear marca "Tía Maruca"' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Marca/ })).toHaveValue('Tía Maruca'))
    expect(fake.writes).toContainEqual(
      expect.objectContaining({ table: 'brands', op: 'insert', payload: { name: 'Tía Maruca' } }),
    )
  })

  it('calculadora de precio: ganancia % y precio final llenan el precio sin IVA', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText(/^Costo/), '712')
    await user.type(screen.getByLabelText(/^Ganancia/), '35')
    expect(screen.getByLabelText(/^Precio de venta/)).toHaveValue('961,2')
    await user.clear(screen.getByLabelText(/^Precio final/))
    await user.type(screen.getByLabelText(/^Precio final/), '1200')
    expect(screen.getByLabelText(/^Precio de venta/)).toHaveValue('991,7355')
    await user.tab()
    // El precio final queda exacto (P-24).
    expect(screen.getByLabelText(/^Precio final/)).toHaveValue('1200')
    expect(screen.getByText('$ 1.200,00')).toBeInTheDocument()
  })

  it('Enter pasa al campo siguiente: elige en los autocompletados y nunca guarda solo', async () => {
    const { user, fake } = setup()
    await user.type(await screen.findByLabelText(/^Nombre/), 'Yogur{Enter}')
    expect(screen.getByRole('combobox', { name: /^Categoría/ })).toHaveFocus()
    await user.keyboard('lac{Enter}')
    expect(screen.getByRole('combobox', { name: /^Categoría/ })).toHaveValue('Lácteos')
    expect(screen.getByRole('combobox', { name: /^Marca/ })).toHaveFocus()
    await user.keyboard('SERE{Enter}')
    expect(screen.getByRole('combobox', { name: /^Marca/ })).toHaveValue('La Serenísima')
    // Proveedor vacío: Enter pasa de largo.
    expect(screen.getByRole('combobox', { name: /^Proveedor/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText(/^Unidad de venta/)).toHaveFocus()
    await user.keyboard('{Enter}')
    // La descripción está plegada: se saltea.
    expect(screen.getByLabelText(/^Costo/)).toHaveFocus()
    await user.keyboard('450{Enter}')
    expect(screen.getByLabelText(/^Ganancia/)).toHaveFocus()
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('Tab con algo escrito en el autocompletado toma la opción marcada', async () => {
    const { user } = setup()
    await user.type(await screen.findByRole('combobox', { name: /^Marca/ }), 'sere')
    await user.tab()
    expect(screen.getByRole('combobox', { name: /^Marca/ })).toHaveValue('La Serenísima')
    expect(screen.getByRole('combobox', { name: /^Proveedor/ })).toHaveFocus()
  })

  it('avisa si el precio es menor al costo, sin bloquear', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText(/^Costo/), '800')
    await user.type(screen.getByLabelText(/^Precio de venta/), '700')
    expect(await screen.findByText('El precio de venta es menor que el costo.')).toBeInTheDocument()
  })
})
