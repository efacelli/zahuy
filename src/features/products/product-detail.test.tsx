import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { todayInAppTimeZone } from '../../lib/dates'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAT = '11111111-1111-4111-8111-111111111111'
const BRAND = '22222222-2222-4222-8222-222222222222'
const TODAY = todayInAppTimeZone()

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const SUMMARY = {
  id: ID,
  sku: '000007',
  barcode: '7790001234567',
  name: 'Yogur frutilla 190 g',
  category_id: CAT,
  category_name: 'Lácteos',
  brand_id: BRAND,
  brand_name: 'La Serenísima',
  supplier_id: null,
  supplier_name: null,
  sale_unit: 'unit',
  cost_price: 450.5,
  sale_price: 1000,
  sale_price_with_vat: 1210,
  vat_rate: 21,
  boxes_quantity: 5,
  units_per_box: 12,
  min_stock: 10,
  is_active: true,
  stock_quantity: 84,
  next_expires_on: addDays(TODAY, 5),
  next_expiry_status: 'expires_urgent',
  active_batches_count: 2,
  is_low_stock: false,
  units_in_boxes: 60,
  loose_units: 24,
  has_box_mismatch: false,
}

const EDITABLE = {
  id: ID,
  sku: '000007',
  barcode: '7790001234567',
  name: 'Yogur frutilla 190 g',
  description: null,
  category_id: CAT,
  brand_id: BRAND,
  supplier_id: null,
  sale_unit: 'unit',
  cost_price: 450.5,
  sale_price: 1000,
  vat_rate: 21,
  boxes_quantity: 5,
  units_per_box: 12,
  min_stock: 10,
  is_active: true,
}

function setup(role: 'staff' | 'manager', path = `/productos/${ID}`) {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('v_product_list', [SUMMARY])
  fake.setTable('v_batch_status', [
    { id: 'b1', product_id: ID, batch_number: 'L-01', received_on: addDays(TODAY, -10), expires_on: addDays(TODAY, 5), quantity_available: 30, expiry_status: 'expires_urgent' },
    { id: 'b2', product_id: ID, batch_number: null, received_on: addDays(TODAY, -40), expires_on: addDays(TODAY, -1), quantity_available: 0, expiry_status: 'depleted' },
  ])
  fake.setTable('stock_movements', [
    {
      id: 'm1',
      product_id: ID,
      movement_type: 'entry',
      quantity: 30,
      signed_quantity: 30,
      batch_quantity_after: 30,
      reason: null,
      notes: null,
      occurred_at: '2026-11-14T13:00:00Z',
      reverses_movement_id: null,
      batch: { batch_number: 'L-01', expires_on: addDays(TODAY, 5), product: { sku: '000007', name: 'Yogur', sale_unit: 'unit' } },
      author: { full_name: 'Empleado de prueba' },
    },
  ])
  fake.setTable('products', [{ ...EDITABLE }])
  fake.setTable('categories', [{ id: CAT, name: 'Lácteos', is_active: true }])
  fake.setTable('brands', [{ id: BRAND, name: 'La Serenísima', is_active: true }])
  fake.setTable('suppliers', [])
  const router = renderApp(path, fake.client)
  return { fake, router, user: userEvent.setup() }
}

describe('ficha del producto', () => {
  it('muestra stock con desglose de cajas, precio final, lotes y movimientos', async () => {
    setup('manager')
    expect(await screen.findByRole('heading', { level: 1, name: 'Yogur frutilla 190 g' })).toBeInTheDocument()
    expect(screen.getByText('84 u.')).toBeInTheDocument()
    expect(screen.getByText(/24 u\. sueltas \+ 5 cajas de 12/)).toBeInTheDocument()
    expect(screen.getByText(/1\.210,00/)).toBeInTheDocument()
    const lots = await screen.findByRole('table', { name: 'Lotes de Yogur frutilla 190 g' })
    expect(within(lots).getByText('L-01')).toBeInTheDocument()
    expect(within(lots).getByText('Agotado')).toBeInTheDocument()
    const moves = screen.getByRole('table', { name: 'Movimientos de Yogur frutilla 190 g' })
    expect(within(moves).getByText('+30 u.')).toBeInTheDocument()
    expect(within(moves).getByText('Empleado de prueba')).toBeInTheDocument()
  })

  it('el encargado ve "Editar producto"; el empleado solo "Actualizar cajas"', async () => {
    setup('staff')
    expect(await screen.findByRole('button', { name: 'Actualizar cajas' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Editar producto' })).not.toBeInTheDocument()
  })

  it('el empleado actualiza solo el conteo de cajas', async () => {
    const { user, fake } = setup('staff')
    await user.click(await screen.findByRole('button', { name: 'Actualizar cajas' }))
    const dialog = screen.getByRole('dialog', { name: 'Actualizar cajas en depósito' })
    const input = within(dialog).getByLabelText(/^Cajas cerradas/)
    await user.clear(input)
    await user.type(input, '8')
    expect(within(dialog).getByText(/96 u\. en cajas de 12/)).toBeInTheDocument()
    expect(within(dialog).getByText(/superan el stock registrado/)).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '6')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toEqual({ table: 'products', op: 'update', payload: { boxes_quantity: 6 }, filters: { id: ID } })
  })

  it('Enter guarda el conteo de cajas', async () => {
    const { user, fake } = setup('staff')
    await user.click(await screen.findByRole('button', { name: 'Actualizar cajas' }))
    const dialog = screen.getByRole('dialog', { name: 'Actualizar cajas en depósito' })
    const input = within(dialog).getByLabelText(/^Cajas cerradas/)
    await user.clear(input)
    await user.type(input, '3{Enter}')
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toEqual({ table: 'products', op: 'update', payload: { boxes_quantity: 3 }, filters: { id: ID } })
  })

  it('si la base no actualiza ninguna fila (RLS), avisa que no hay permiso', async () => {
    const { user, fake } = setup('staff')
    fake.failNextWrite('products', { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })
    await user.click(await screen.findByRole('button', { name: 'Actualizar cajas' }))
    const dialog = screen.getByRole('dialog', { name: 'Actualizar cajas en depósito' })
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/No tenés permiso/)
  })

  it('un lote sin vencimiento (dato de migración) se muestra como "No vence"', async () => {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    fake.setTable('v_product_list', [SUMMARY])
    fake.setTable('v_batch_status', [
      {
        id: 'b-null', product_id: ID, product_sku: '000007', product_name: 'Yogur frutilla 190 g', product_is_active: true,
        sale_unit: 'unit', category_id: CAT, category_name: 'Lácteos', batch_number: 'MIG-1', received_on: TODAY,
        expires_on: null, quantity_available: 4, days_to_expiry: null, expiry_status: 'no_expiry',
      },
    ])
    fake.setTable('stock_movements', [])
    renderApp(`/productos/${ID}`, fake.client)
    const batches = await screen.findByRole('table', { name: /^Lotes de/ })
    expect(within(batches).getByText('MIG-1')).toBeInTheDocument()
    expect(within(batches).getByText('No vence')).toBeInTheDocument()
  })

  it('un producto inexistente lo dice', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('v_product_list', [])
    renderApp(`/productos/${ID}`, fake.client)
    expect(await screen.findByText('No encontramos ese producto')).toBeInTheDocument()
  })
})

describe('edición del producto', () => {
  it('carga los datos, muestra el SKU sin dejar cambiarlo y no ofrece stock inicial', async () => {
    setup('manager', `/productos/${ID}/editar`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Editar: Yogur frutilla 190 g' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Yogur frutilla 190 g')
    expect(screen.getByLabelText(/^Costo/)).toHaveValue('450,5')
    expect(screen.getByText(/SKU 000007/)).toBeInTheDocument()
    expect(screen.queryByText(/Stock inicial/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Cantidad inicial/)).not.toBeInTheDocument()
  })

  it('guarda solo las columnas editables y vuelve a la ficha', async () => {
    const { user, fake, router } = setup('manager', `/productos/${ID}/editar`)
    const price = await screen.findByLabelText(/^Precio de venta/)
    await user.clear(price)
    await user.type(price, '1100')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    const write = fake.writes[0]!
    expect(write).toMatchObject({ table: 'products', op: 'update', filters: { id: ID } })
    expect(write.payload).toMatchObject({ sale_price: 1100, cost_price: 450.5, units_per_box: 12, boxes_quantity: 5 })
    expect(write.payload).not.toHaveProperty('sku')
    expect(write.payload).not.toHaveProperty('id')
    await waitFor(() => expect(router.state.location.pathname).toBe(`/productos/${ID}`))
  })

  it('explica que la unidad de venta no se cambia si hay movimientos', async () => {
    const { user, fake } = setup('manager', `/productos/${ID}/editar`)
    fake.failNextWrite('products', {
      code: '23514',
      message: 'products.sale_unit no se puede cambiar: el producto tiene movimientos',
    })
    await user.selectOptions(await screen.findByLabelText(/^Unidad de venta/), 'kg')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede cambiar la unidad de venta')
  })

  it('el empleado no puede abrir la edición', async () => {
    setup('staff', `/productos/${ID}/editar`)
    expect(await screen.findByText('No tenés permiso para esta sección')).toBeInTheDocument()
  })
})

describe('historial de precios en la ficha', () => {
  it('el encargado ve los cambios con precio final, origen y usuario', async () => {
    const { fake } = setup('manager')
    fake.setTable('price_history', [
      {
        id: 'h1',
        product_id: ID,
        changed_at: '2026-11-16T15:00:00Z',
        old_sale_price: 1000,
        new_sale_price: 1080,
        old_cost_price: 450.5,
        new_cost_price: 450.5,
        source: 'bulk_increase',
        reason: 'Lista noviembre',
        author: { full_name: 'Encargado de prueba' },
      },
    ])
    const table = await screen.findByRole('table', { name: 'Cambios de precio de Yogur frutilla 190 g' })
    expect(within(table).getByText('Aumento masivo')).toBeInTheDocument()
    expect(within(table).getByText('Lista noviembre')).toBeInTheDocument()
    expect(within(table).getByText('Encargado de prueba')).toBeInTheDocument()
    // 1000 y 1080 sin IVA → 1210 y 1306,80 con IVA 21 %.
    expect(within(table).getByText('$ 1.306,80', { exact: false })).toBeInTheDocument()
    expect(within(table).getByText(/\+8 %/)).toBeInTheDocument()
    expect(within(table).getByText('Sin cambio')).toBeInTheDocument()
    const call = fake.from.mock.calls.find((c) => c[0] === 'price_history')
    expect(call).toBeTruthy()
  })

  it('sin cambios muestra el estado vacío', async () => {
    setup('manager')
    expect(await screen.findByText('Sin cambios de precio')).toBeInTheDocument()
  })

  it('sin la migración avisa que no está habilitado', async () => {
    const { fake } = setup('manager')
    fake.setTable('price_history', null, { code: 'PGRST205', message: 'not found' })
    expect(await screen.findByText('El historial de precios todavía no está habilitado en la base.')).toBeInTheDocument()
  })

  it('el empleado no ve el historial (incluye costos)', async () => {
    const { fake } = setup('staff')
    expect(await screen.findByRole('table', { name: 'Lotes de Yogur frutilla 190 g' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Historial de precios' })).not.toBeInTheDocument()
    expect(fake.from.mock.calls.some((c) => c[0] === 'price_history')).toBe(false)
  })
})

describe('imagen del producto', () => {
  it('el encargado sube una foto: va al bucket con la convención de ruta y se guarda la ruta', async () => {
    const { fake, user } = setup('manager')
    await user.upload(await screen.findByLabelText('Subir imagen'), new File(['png'], 'foto.png', { type: 'image/png' }))
    expect(await screen.findByText('Imagen guardada.')).toBeInTheDocument()
    const [path] = fake.filesIn('product-images')
    expect(path).toMatch(new RegExp(`^${ID}/[0-9a-f-]{36}\\.png$`))
    expect(fake.writes).toContainEqual({ table: 'products', op: 'update', payload: { image_path: path }, filters: { id: ID } })
  })

  it('rechaza archivos que no son JPG, PNG o WebP sin subir nada', async () => {
    const { fake } = setup('manager')
    const input = await screen.findByLabelText('Subir imagen')
    // `upload` respeta `accept`; se simula un archivo que el navegador dejó pasar igual.
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(input, new File(['gif'], 'foto.gif', { type: 'image/gif' }))
    expect(await screen.findByText('Elegí una foto JPG, PNG o WebP.')).toBeInTheDocument()
    expect(fake.filesIn('product-images')).toEqual([])
  })

  it('muestra la foto con URL firmada; quitarla pide confirmación y borra el archivo', async () => {
    const path = `${ID}/11111111-2222-4333-8444-555555555555.webp`
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    fake.setTable('v_product_list', [{ ...SUMMARY, image_path: path }])
    fake.setTable('v_batch_status', [])
    fake.setTable('stock_movements', [])
    fake.setTable('products', [{ ...EDITABLE, image_path: path }])
    fake.putFile('product-images', path)
    renderApp(`/productos/${ID}`, fake.client)
    const user = userEvent.setup()

    const img = await screen.findByRole('img', { name: 'Yogur frutilla 190 g' })
    expect(img.getAttribute('src')).toContain(`product-images/${path}`)
    await user.click(screen.getByRole('button', { name: 'Quitar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Quitar imagen' })
    await user.click(within(dialog).getByRole('button', { name: 'Quitar imagen' }))
    expect(await screen.findByText('Imagen quitada.')).toBeInTheDocument()
    expect(fake.writes).toContainEqual({ table: 'products', op: 'update', payload: { image_path: null }, filters: { id: ID } })
    expect(fake.filesIn('product-images')).toEqual([])
  })

  it('si la base rechaza el cambio, borra la foto recién subida', async () => {
    const { fake, user } = setup('manager')
    fake.failNextWrite('products', { code: '42501', message: 'permission denied' })
    await user.upload(await screen.findByLabelText('Subir imagen'), new File(['jpg'], 'foto.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
    expect(fake.filesIn('product-images')).toEqual([])
  })

  it('el empleado ve la imagen pero no puede cambiarla', async () => {
    setup('staff')
    expect(await screen.findByText('Sin imagen')).toBeInTheDocument()
    expect(screen.queryByLabelText('Subir imagen')).not.toBeInTheDocument()
  })
})
