import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { cartReducer, cartTotal, parseScanInput, type CartProduct } from './cart'
import { planPayments, type PaymentDraft } from './payment'

const YOGUR = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sku: '000001',
  name: 'Yogur frutilla',
  sale_unit: 'unit',
  sale_price_with_vat: 412.33,
  is_active: true,
  barcode: '7790000000017',
}
const QUESO = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sku: '000002',
  name: 'Queso cremoso',
  sale_unit: 'kg',
  sale_price_with_vat: 9000,
  is_active: true,
  barcode: null,
}
const CASH = { id: 'pm-cash', code: 'cash', name: 'Efectivo', is_cash: true, is_active: true, sort_order: 1 }
const DEBIT = { id: 'pm-debit', code: 'debit', name: 'Débito', is_cash: false, is_active: true, sort_order: 2 }
const SESSION = {
  cash_session_id: 'ses-1',
  cash_register_id: 'reg-1',
  cash_register_name: 'Caja 1',
  status: 'open',
  opened_at: '2026-11-15T12:00:00Z',
  opening_amount: 5000,
  sales_count: 0,
  sales_total: 0,
  expected_cash: 5000,
}

function setup({ sessions = [SESSION] as unknown[] } = {}) {
  const fake = createFakeSupabase(fakeSession(), { role: 'staff' })
  fake.setTable('products', [{ ...YOGUR }, { ...QUESO }])
  fake.setTable('v_cash_session_summary', sessions as Record<string, unknown>[])
  fake.setTable('cash_registers', [
    { id: 'reg-1', name: 'Caja 1', is_active: true },
    { id: 'reg-2', name: 'Caja 2', is_active: true },
  ])
  fake.setTable('payment_methods', [CASH, DEBIT])
  renderApp('/caja', fake.client)
  return { fake, user: userEvent.setup() }
}

beforeEach(() => window.localStorage.clear())

const scanField = () => screen.getByLabelText('Código o producto')

async function enterSale(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Vender en Caja 1' }))
  await screen.findByRole('heading', { name: 'Caja · Caja 1' })
}

describe('carrito (reglas puras)', () => {
  const p = YOGUR as unknown as CartProduct
  it('escanear dos veces suma en la misma línea; cantidad 0 la quita', () => {
    let lines = cartReducer([], { type: 'add', product: p })
    lines = cartReducer(lines, { type: 'add', product: p, quantity: 2 })
    expect(lines).toHaveLength(1)
    expect(lines[0]!.quantity).toBe(3)
    expect(cartTotal(lines)).toBe(1236.99)
    expect(cartReducer(lines, { type: 'set', productId: p.id, quantity: 0 })).toEqual([])
  })

  it('cantidad con asterisco', () => {
    expect(parseScanInput('3*7790000000017')).toEqual({ quantity: 3, text: '7790000000017' })
    expect(parseScanInput('1,5 * queso')).toEqual({ quantity: 1.5, text: 'queso' })
    expect(parseScanInput('7790000000017')).toEqual({ quantity: null, text: '7790000000017' })
  })

  it('cobro: efectivo redondeado, mixto y vuelto', () => {
    const cash: PaymentDraft = { method: { id: 'c', code: 'cash', name: 'Efectivo', is_cash: true }, amount: '', tendered: '2000', reference: '' }
    const debit: PaymentDraft = { method: { id: 'd', code: 'debit', name: 'Débito', is_cash: false }, amount: '1000', tendered: '', reference: '' }
    const onlyCash = planPayments(1237, [cash])
    expect(onlyCash).toMatchObject({ cashAmount: 1200, rounding: -37, toPay: 1200, change: 800, errors: [] })
    expect(onlyCash.payments).toEqual([{ payment_method_id: 'c', amount: 1200, tendered_amount: 2000, reference: null }])

    // Mixto: el total se redondea (1287 → 1300) y el efectivo cubre lo que falta.
    const mixed = planPayments(1287, [debit, { ...cash, tendered: '' }])
    expect(mixed).toMatchObject({ toPay: 1300, cashAmount: 300, rounding: 13, errors: [] })

    const credit: PaymentDraft = { ...debit, method: { id: 'k', code: 'credit', name: 'Crédito', is_cash: false }, amount: '100' }
    expect(planPayments(1237, [debit, credit]).errors[0]).toMatch(/Faltan/)
    // Menos de $50: exacto.
    expect(planPayments(30, [cash])).toMatchObject({ cashAmount: 30, rounding: 0, toPay: 30, change: 1970, errors: [] })
    expect(planPayments(1237, [{ ...cash, tendered: '1000' }]).errors[0]).toMatch(/menor/)
  })

  it('cobro virtual: también redondea, y el monto a cobrar se puede cambiar', () => {
    const debit: PaymentDraft = { method: { id: 'd', code: 'debit', name: 'Débito', is_cash: false }, amount: '', tendered: '', reference: '' }
    expect(planPayments(1237, [debit])).toMatchObject({
      suggested: 1200,
      toPay: 1200,
      rounding: -37,
      payments: [{ payment_method_id: 'd', amount: 1200, tendered_amount: null, reference: null }],
    })
    // El cajero vuelve al monto exacto.
    expect(planPayments(1237, [debit], '1237')).toMatchObject({ toPay: 1237, rounding: 0, errors: [] })
    // No puede alejarse del total en $100 o más.
    expect(planPayments(1237, [debit], '1400').errors[0]).toMatch(/no puede diferir/)
    expect(planPayments(1237, [debit], 'abc').errors[0]).toMatch(/no es válido/)
  })
})

describe('pantalla de caja', () => {
  it('sin las tablas de ventas en la base, avisa que todavía no está habilitada', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('v_cash_session_summary', null, { code: 'PGRST205', message: 'not found' })
    renderApp('/caja', fake.client)
    expect(await screen.findByText('La caja todavía no está habilitada')).toBeInTheDocument()
  })

  it('abre una caja con el efectivo inicial', async () => {
    const { fake, user } = setup({ sessions: [] })
    fake.setRpcResult('open_cash_session', { id: 'ses-9' })
    await user.type(await screen.findByLabelText(/^Efectivo inicial/), '5000')
    await user.click(screen.getByRole('button', { name: 'Abrir caja' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('open_cash_session')
    expect(params).toMatchObject({ p_cash_register_id: 'reg-1', p_opening_amount: 5000 })
  })

  it('escanear suma al carrito; efectivo con redondeo, vuelto y ticket interno', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-1', sale_number: 15, total_amount: 1236.99, created_at: '2026-11-15T15:00:00Z' })
    await enterSale(user)

    await user.type(scanField(), '7790000000017{Enter}')
    await user.type(scanField(), '2*7790000000017{Enter}')
    const cart = await screen.findByRole('table', { name: 'Productos del carrito' })
    expect(within(cart).getByLabelText(/^Cantidad de Yogur frutilla/)).toHaveValue('3')
    expect(screen.getByLabelText('Total')).toHaveTextContent('1.236,99')

    // Enter con el campo vacío abre el cobro (todo en efectivo por defecto).
    await user.type(scanField(), '{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    expect(within(dialog).getByText('A cobrar')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Recibido'), '2000')
    expect(within(dialog).getByRole('status')).toHaveTextContent(/Vuelto: \$\s800,00/)
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))

    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('register_sale')
    expect(params).toMatchObject({
      p_cash_session_id: 'ses-1',
      p_items: [{ product_id: YOGUR.id, quantity: 3 }],
      p_payments: [{ payment_method_id: 'pm-cash', amount: 1200, tendered_amount: 2000, reference: null }],
    })
    const ticket = await screen.findByRole('dialog', { name: 'Venta n.º 15 registrada' })
    expect(within(ticket).getByText('NO VÁLIDO COMO FACTURA')).toBeInTheDocument()
    await user.click(within(ticket).getByRole('button', { name: 'Nueva venta' }))
    expect(await screen.findByText('El carrito está vacío.')).toBeInTheDocument()
  })

  it('todo con débito: redondea igual (412,33 → 400)', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-2', sale_number: 16, total_amount: 412.33, created_at: '2026-11-15T15:00:00Z' })
    await enterSale(user)
    await user.type(scanField(), '7790000000017{Enter}')
    await user.click(screen.getByRole('button', { name: 'Cobrar (F12)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(await within(dialog).findByRole('button', { name: 'Todo con Débito' }))
    expect(within(dialog).getByLabelText('A cobrar')).toHaveValue('400')
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    expect((fake.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      p_payments: [{ payment_method_id: 'pm-debit', amount: 400, tendered_amount: null }],
    })
  })

  it('el cajero puede cambiar el monto a cobrar (por ejemplo, al exacto)', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-3', sale_number: 17, total_amount: 412.33, created_at: '2026-11-15T15:00:00Z' })
    await enterSale(user)
    await user.type(scanField(), '7790000000017{Enter}')
    await user.click(screen.getByRole('button', { name: 'Cobrar (F12)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(await within(dialog).findByRole('button', { name: 'Todo con Débito' }))
    const charged = within(dialog).getByLabelText('A cobrar')
    await user.clear(charged)
    await user.type(charged, '412,33')
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    expect((fake.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      p_payments: [{ payment_method_id: 'pm-debit', amount: 412.33 }],
    })
  })

  it('sin stock: muestra el error y el carrito queda como estaba', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', null, { code: 'P0001', message: 'INSUFFICIENT_STOCK' })
    await enterSale(user)
    await user.type(scanField(), '7790000000017{Enter}')
    await user.type(scanField(), '{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No hay stock suficiente')
    await user.click(within(dialog).getByRole('button', { name: 'Volver al carrito' }))
    expect(screen.getByRole('table', { name: 'Productos del carrito' })).toBeInTheDocument()
  })

  it('código desconocido: avisa y no agrega nada', async () => {
    const { user } = setup()
    await enterSale(user)
    await user.type(scanField(), '7799999999999{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay ningún producto activo con el código 7799999999999')
    expect(screen.getByText('El carrito está vacío.')).toBeInTheDocument()
  })
})
