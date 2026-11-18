import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { DEFAULT_DISCOUNT_RULE } from '../../domain/quantity-discount'
import { parseScaleLabel } from '../../domain/barcode'
import { cartReducer, manualDifference, mixError, parseAmount, parseScanInput, priceCart, priceLine, toSaleItem, type CartProduct } from './cart'
import { planPayments, type PaymentDraft } from './payment'
import { pageRule, readTicketPaper, resetTicketPaperMemory } from './ticket-paper'

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
  // P-40: el empleado no ve lo esperado mientras la caja está abierta.
  expected_cash: null,
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

beforeEach(() => {
  window.localStorage.clear()
  resetTicketPaperMemory()
})

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
    expect(priceCart(lines, DEFAULT_DISCOUNT_RULE).total).toBe(1236.99)
    expect(cartReducer(lines, { type: 'set', key: lines[0]!.key, quantity: 0 })).toEqual([])
  })

  it('descuento por cantidad: sugerido, elegido y cuentas de la base (§16.2)', () => {
    const six = priceLine({ kind: 'product', key: 'k', product: p, quantity: 6, discountPercent: null }, DEFAULT_DISCOUNT_RULE)
    // 6 × 412,33 = 2473,98; 5 % = 123,70 (redondeado); línea = 2350,28.
    expect(six).toMatchObject({ suggestedPercent: 5, appliedPercent: 5, listTotal: 2473.98, discountAmount: 123.7, total: 2350.28 })
    const edited = priceLine({ kind: 'product', key: 'k', product: p, quantity: 6, discountPercent: 0 }, DEFAULT_DISCOUNT_RULE)
    expect(edited).toMatchObject({ suggestedPercent: 5, appliedPercent: 0, discountAmount: 0, total: 2473.98 })
    // El elegido se conserva al cambiar la cantidad; el sugerido acompaña a la cantidad.
    let lines = cartReducer([], { type: 'add', product: p, quantity: 6 })
    lines = cartReducer(lines, { type: 'discount', key: lines[0]!.key, percent: 12.5 })
    lines = cartReducer(lines, { type: 'add', product: p })
    expect(lines[0]).toMatchObject({ quantity: 7, discountPercent: 12.5 })
    const queso = priceLine({ kind: 'product', key: 'q', product: QUESO as unknown as CartProduct, quantity: 6.5, discountPercent: null }, DEFAULT_DISCOUNT_RULE)
    expect(queso.suggestedPercent).toBe(0)
    const cart = priceCart([...lines, { kind: 'product', key: 'x', product: p, quantity: 12, discountPercent: null }], DEFAULT_DISCOUNT_RULE)
    expect(cart.discountTotal).toBe(Math.round((360.79 + 494.8) * 100) / 100)
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

describe('importe manual y líneas libres (§20, reglas puras)', () => {
  const queso = QUESO as unknown as CartProduct
  const yogur = YOGUR as unknown as CartProduct

  it('lee la etiqueta de la balanza: 20 + PLU + gramos + verificador', () => {
    expect(parseScaleLabel('2000005002458')).toEqual({ code: '2000005002458', plu: '00005', weightKg: 0.245 })
    expect(parseScaleLabel('2000005002457')).toBeNull() // verificador mal
    expect(parseScaleLabel('7790000000017')).toBeNull() // otro prefijo
    expect(parseScaleLabel('200000500245')).toBeNull() // largo
  })

  it('líneas manuales y libres: importe fijo, sin descuento, cada una aparte', () => {
    let lines = cartReducer([], { type: 'addManual', product: queso, quantity: 0.245, total: 2327.5, barcode: '2000005002458' })
    lines = cartReducer(lines, { type: 'addManual', product: queso, quantity: 0.3, total: 2700, barcode: null })
    lines = cartReducer(lines, { type: 'addFree', description: '  Pan casero ', vatRate: 10.5, quantity: 2, total: 1500 })
    lines = cartReducer(lines, { type: 'add', product: yogur, quantity: 6 })
    expect(lines.map((l) => l.kind)).toEqual(['product', 'free', 'manual', 'manual'])
    // set/discount no tocan las líneas con importe fijo.
    const manualKey = lines[2]!.key
    expect(cartReducer(lines, { type: 'set', key: manualKey, quantity: 5 })[2]).toEqual(lines[2])
    const cart = priceCart(lines, DEFAULT_DISCOUNT_RULE)
    expect(cart.lines[1]).toMatchObject({ listTotal: 1500, discountAmount: 0, total: 1500 })
    expect(cart.total).toBe(Math.round((2350.28 + 1500 + 2700 + 2327.5) * 100) / 100)
    expect(cart.lines.map(toSaleItem)).toEqual([
      { product_id: YOGUR.id, quantity: 6, discount_percent: 5 },
      { product_id: null, description: 'Pan casero', vat_rate: 10.5, quantity: 2, discount_percent: 0, manual_line_total: 1500 },
      { product_id: QUESO.id, quantity: 0.3, discount_percent: 0, manual_line_total: 2700 },
      { product_id: QUESO.id, quantity: 0.245, discount_percent: 0, manual_line_total: 2327.5 },
    ])
    expect(cartReducer(lines, { type: 'remove', key: manualKey })).toHaveLength(3)
  })

  it('un producto no puede ir a precio de lista y con importe manual a la vez', () => {
    const withList = cartReducer([], { type: 'add', product: queso, quantity: 1 })
    expect(mixError(withList, QUESO.id, 'manual')).toMatch(/precio de Zahuy/)
    expect(mixError(withList, QUESO.id, 'product')).toBeNull()
    const withManual = cartReducer([], { type: 'addManual', product: queso, quantity: 1, total: 9000, barcode: null })
    expect(mixError(withManual, QUESO.id, 'product')).toMatch(/importe de etiqueta/)
    expect(mixError(withManual, YOGUR.id, 'product')).toBeNull()
  })

  it('importe escrito y aviso de diferencia mayor al 20 %', () => {
    expect(parseAmount('2327,50')).toEqual({ value: 2327.5, error: null })
    expect(parseAmount('').error).toMatch(/Escribí el importe/)
    expect(parseAmount('0').error).toMatch(/mayor que cero/)
    expect(parseAmount('10,123').error).toMatch(/2 decimales/)
    expect(manualDifference(2327.5, 2205).warn).toBe(false)
    expect(manualDifference(24500, 2205).warn).toBe(true)
    expect(manualDifference(1000, 2205).warn).toBe(true)
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
    fake.setTable('sales_settings', [
      {
        id: 'sales-1',
        rounding_multiple: 100,
        quantity_discount_step: 6,
        quantity_discount_percent: 5,
        quantity_discount_max_percent: 30,
        store_name: 'Almacén de prueba',
        store_address: 'Calle Falsa 123',
        store_tax_id: '20123456786',
      },
    ])
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
      p_items: [{ product_id: YOGUR.id, quantity: 3, discount_percent: 0 }],
      p_payments: [{ payment_method_id: 'pm-cash', amount: 1200, tendered_amount: 2000, reference: null }],
    })
    const ticket = await screen.findByRole('dialog', { name: 'Venta n.º 15 registrada' })
    expect(within(ticket).getByText('NO VÁLIDO COMO FACTURA')).toBeInTheDocument()
    // Encabezado con los datos del comercio cargados en Configuración (§18).
    expect(within(ticket).getByText('Almacén de prueba')).toBeInTheDocument()
    expect(ticket).toHaveTextContent('Calle Falsa 123')
    expect(ticket).toHaveTextContent('CUIT 20-12345678-6')
    // El redondeo no se imprime: el total del ticket es lo cobrado (1.236,99 → 1.200).
    const printed = ticket.querySelector('[data-print="ticket"]') as HTMLElement
    expect(printed).not.toHaveTextContent(/Redondeo/)
    expect(within(printed).getByRole('rowheader', { name: 'Total' }).closest('tr')).toHaveTextContent(/1\.200,00/)

    // Papel del ticket: térmica de 80 mm por defecto; el cambio se recuerda en el equipo.
    const body = ticket.querySelector('[data-print="ticket"]')
    expect(body).toHaveAttribute('data-paper', '80mm')
    await user.selectOptions(within(ticket).getByLabelText('Papel'), 'Térmica 58 mm')
    expect(body).toHaveAttribute('data-paper', '58mm')
    expect(window.localStorage.getItem('zahuy.ticket.papel')).toBe('58mm')

    await user.click(within(ticket).getByRole('button', { name: 'Nueva venta' }))
    expect(await screen.findByText('El carrito está vacío.')).toBeInTheDocument()
  })

  it('«Guardar sin ticket» sin vuelto: registra la venta igual y vuelve al carrito vacío, sin ticket', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-2', sale_number: 16, total_amount: 400, created_at: '2026-11-15T15:00:00Z' })
    await enterSale(user)
    await user.type(scanField(), '7790000000017{Enter}')
    await screen.findByRole('table', { name: 'Productos del carrito' })
    await user.type(scanField(), '{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(within(dialog).getByRole('button', { name: 'Guardar sin ticket' }))

    // La venta se registra igual (descuenta stock); la base recibe lo mismo que con ticket.
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('register_sale')
    expect(params).toMatchObject({ p_cash_session_id: 'ses-1', p_items: [{ product_id: YOGUR.id, quantity: 1 }] })

    // No aparece el ticket y el carrito queda listo para la próxima venta.
    expect(await screen.findByText('El carrito está vacío.')).toBeInTheDocument()
    expect(screen.queryByText('NO VÁLIDO COMO FACTURA')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /registrada/ })).not.toBeInTheDocument()
    expect(await screen.findByText(/Venta n\.º 16 guardada sin ticket/)).toBeInTheDocument()
  })

  it('«Guardar sin ticket» con vuelto: muestra solo el vuelto, sin ticket', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-3', sale_number: 17, total_amount: 1236.99, created_at: '2026-11-15T15:00:00Z' })
    await enterSale(user)
    await user.type(scanField(), '7790000000017{Enter}')
    await user.type(scanField(), '2*7790000000017{Enter}')
    await screen.findByRole('table', { name: 'Productos del carrito' })
    await user.type(scanField(), '{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.type(within(dialog).getByLabelText('Recibido'), '2000')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar sin ticket' }))

    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const notice = await screen.findByRole('dialog', { name: 'Venta n.º 17 guardada sin ticket' })
    expect(notice).toHaveTextContent(/Vuelto: \$\s800,00/)
    expect(notice).toHaveTextContent('el stock ya se descontó')
    expect(screen.queryByText('NO VÁLIDO COMO FACTURA')).not.toBeInTheDocument()
    await user.click(within(notice).getByRole('button', { name: 'Nueva venta' }))
    expect(await screen.findByText('El carrito está vacío.')).toBeInTheDocument()
  })

  it('6 unidades: sugiere 5 %, el cajero lo cambia y la base recibe lo que se ve', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-9', sale_number: 20, total_amount: 2226.58, created_at: '2026-11-15T15:00:00Z' })
    await enterSale(user)
    await user.type(scanField(), '6*7790000000017{Enter}')
    const cart = await screen.findByRole('table', { name: 'Productos del carrito' })
    // Después de cada Enter el foco vuelve al buscador en el próximo cuadro: se espera antes de seguir.
    const focusBack = () => waitFor(() => expect(scanField()).toHaveFocus())
    await focusBack()
    const discount = within(cart).getByLabelText('Descuento de Yogur frutilla (%)')
    expect(discount).toHaveValue('5')
    expect(within(cart).getByText('Sugerido')).toBeInTheDocument()
    expect(screen.getByLabelText('Total')).toHaveTextContent('2.350,28')
    expect(screen.getByLabelText('Total')).toHaveTextContent(/Descuentos: −\$\s123,70/)

    // Fuera del tope: avisa y queda el anterior.
    await user.clear(discount)
    await user.type(discount, '40{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 0 y 30 %')
    await focusBack()
    expect(discount).toHaveValue('5')

    // Lo sube a 10 %: 2473,98 − 247,40 = 2226,58.
    await user.clear(discount)
    await user.type(discount, '10{Enter}')
    await focusBack()
    expect(screen.getByLabelText('Total')).toHaveTextContent('2.226,58')
    const reset = within(cart).getByRole('button', { name: 'Sugerido: 5 %' })
    expect(reset).toBeInTheDocument()

    await user.type(scanField(), '{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({
      p_items: [{ product_id: YOGUR.id, quantity: 6, discount_percent: 10 }],
      p_payments: [{ payment_method_id: 'pm-cash', amount: 2200 }],
    })
    const ticket = await screen.findByRole('dialog', { name: 'Venta n.º 20 registrada' })
    expect(within(ticket).getByText(/Desc\. 10 %/)).toBeInTheDocument()
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

describe('caja: balanza y productos sin cargar (§20)', () => {
  it('sin la migración en la base: botones deshabilitados y la etiqueta no se cobra', async () => {
    const { fake, user } = setup()
    fake.setTable('sale_items', null, { code: '42703', message: 'column sale_items.price_source does not exist' })
    await enterSale(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Producto de balanza' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Producto sin cargar' })).toBeDisabled()
    await user.type(scanField(), '2000005002458{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('todavía no están habilitadas')
    expect(screen.getByText('El carrito está vacío.')).toBeInTheDocument()
  })

  it('etiqueta de balanza: elige el producto, escribe el importe y la base lo recibe', async () => {
    const { fake, user } = setup()
    fake.setRpcResult('register_sale', { id: 'sale-5', sale_number: 30, total_amount: 3827.5, created_at: '2026-11-17T15:00:00Z' })
    await enterSale(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Producto de balanza' })).toBeEnabled())

    await user.type(scanField(), '2000005002458{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Producto de balanza' })
    expect(dialog).toHaveTextContent('0,245')
    // Sin elegir producto no agrega.
    await user.click(within(dialog).getByRole('button', { name: 'Agregar al carrito' }))
    expect(within(dialog).getByText('Elegí qué producto es.')).toBeInTheDocument()
    await user.click(await within(dialog).findByRole('button', { name: /Queso cremoso/ }))
    // 0,245 kg × 9000 = 2205; 24.500 difiere más de 20 %: avisa pero deja seguir.
    await user.type(within(dialog).getByLabelText(/^Importe de la etiqueta/), '24500')
    expect(dialog).toHaveTextContent('2.205,00')
    expect(dialog).toHaveTextContent(/difiere 1.011 %.*Se puede cobrar igual/)
    await user.clear(within(dialog).getByLabelText(/^Importe de la etiqueta/))
    await user.type(within(dialog).getByLabelText(/^Importe de la etiqueta/), '2327,50')
    await user.click(within(dialog).getByRole('button', { name: 'Agregar al carrito' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const cart = screen.getByRole('table', { name: 'Productos del carrito' })
    expect(within(cart).getByText(/Importe de etiqueta/)).toBeInTheDocument()

    // La misma etiqueta otra vez: avisa que se repite.
    await user.type(scanField(), '2000005002458{Enter}')
    const again = await screen.findByRole('dialog', { name: 'Producto de balanza' })
    expect(within(again).getByRole('alert')).toHaveTextContent('ya está en el carrito')
    await user.click(within(again).getByRole('button', { name: 'Cancelar' }))

    // Línea libre.
    await user.click(screen.getByRole('button', { name: 'Producto sin cargar' }))
    const free = await screen.findByRole('dialog', { name: 'Producto sin cargar' })
    await user.click(within(free).getByRole('button', { name: 'Agregar al carrito' }))
    expect(free).toHaveTextContent(/descripción/i)
    await user.type(within(free).getByLabelText(/^Descripción/), 'Pan casero')
    await user.selectOptions(within(free).getByLabelText(/^IVA/), '10.5')
    await user.type(within(free).getByLabelText(/^Importe total/), '1500')
    await user.click(within(free).getByRole('button', { name: 'Agregar al carrito' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Total')).toHaveTextContent('3.827,50')

    await user.click(screen.getByRole('button', { name: 'Cobrar (F12)' }))
    const pay = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(within(pay).getByRole('button', { name: 'Confirmar venta' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(params).toMatchObject({
      p_items: [
        { product_id: null, description: 'Pan casero', vat_rate: 10.5, quantity: 1, discount_percent: 0, manual_line_total: 1500 },
        { product_id: QUESO.id, quantity: 0.245, discount_percent: 0, manual_line_total: 2327.5 },
      ],
    })
    expect(await screen.findByRole('dialog', { name: 'Venta n.º 30 registrada' })).toHaveTextContent('Pan casero')
  })

  it('balanza a mano: peso escrito; no mezcla con el mismo producto a precio de lista', async () => {
    const { user } = setup()
    await enterSale(user)
    await user.type(scanField(), '0,5*queso')
    await user.click(await screen.findByRole('button', { name: /Queso cremoso/ }))
    await screen.findByRole('table', { name: 'Productos del carrito' })

    await user.click(screen.getByRole('button', { name: 'Producto de balanza' }))
    const dialog = await screen.findByRole('dialog', { name: 'Producto de balanza' })
    await user.type(within(dialog).getByLabelText(/^Peso \(kg\)/), '0,3')
    await user.click(await within(dialog).findByRole('button', { name: /Queso cremoso/ }))
    await user.type(within(dialog).getByLabelText(/^Importe de la etiqueta/), '2700')
    await user.click(within(dialog).getByRole('button', { name: 'Agregar al carrito' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya está en el carrito con el precio de Zahuy')
    expect(screen.queryByText(/Importe de etiqueta/)).not.toBeInTheDocument()
  })
})

describe('papel del ticket', () => {
  it('un valor guardado inválido vuelve al de por defecto', () => {
    window.localStorage.setItem('zahuy.ticket.papel', 'a3')
    expect(readTicketPaper()).toBe('80mm')
    window.localStorage.setItem('zahuy.ticket.papel', 'comun')
    expect(readTicketPaper()).toBe('comun')
  })

  it('las térmicas imprimen sin margen; la hoja común con margen', () => {
    expect(pageRule('58mm')).toBe('@page { margin: 0; }')
    expect(pageRule('comun')).toContain('12mm')
  })
})
