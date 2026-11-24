import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const JUANA = {
  customer_id: 'cus-1',
  name: 'Juana Ficticia',
  document_number: '20111222',
  phone: '3850000000',
  address: null,
  notes: null,
  credit_limit: 5000,
  is_blocked: false,
  blocked_reason: null,
  is_active: true,
  over_limit_authorized_until: null,
  balance: 1500,
  available_credit: 3500,
  last_charge_at: '2026-11-20T15:00:00Z',
  last_payment_at: null,
}
const BRUNO = { ...JUANA, customer_id: 'cus-2', name: 'Bruno Bloqueado', document_number: null, is_blocked: true, balance: 0, available_credit: 5000 }
const CASH = { id: 'pm-cash', code: 'cash', name: 'Efectivo', is_cash: true, is_active: true, sort_order: 1 }
const ACCOUNT = { id: 'pm-account', code: 'account', name: 'Cuenta corriente', is_cash: false, is_active: true, sort_order: 6 }
const SESSION = {
  cash_session_id: 'ses-1',
  cash_register_id: 'reg-1',
  cash_register_name: 'Caja 1',
  status: 'open',
  opened_at: '2026-11-24T12:00:00Z',
  opening_amount: 0,
  sales_count: 0,
  sales_total: 0,
}

function setup(path: string, role: 'manager' | 'staff' = 'manager') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('v_customer_balances', [{ ...JUANA }, { ...BRUNO }])
  fake.setTable('v_customer_account_movements', [
    { customer_id: 'cus-1', kind: 'charge', movement_id: 'ch-1', created_at: '2026-11-20T15:00:00Z', amount: 1500, sale_number: 7,
      payment_method_name: null, reference: null, over_limit: false, voided_at: null, void_reason: null },
  ])
  fake.setTable('v_cash_session_summary', [SESSION])
  fake.setTable('payment_methods', [CASH, ACCOUNT])
  fake.setTable('cash_registers', [{ id: 'reg-1', name: 'Caja 1', is_active: true }])
  fake.setTable('products', [
    { id: 'p-1', sku: '000001', name: 'Yerba', sale_unit: 'unit', sale_price_with_vat: 1000, is_active: true, barcode: '7790000000017' },
  ])
  renderApp(path, fake.client)
  return { fake, user: userEvent.setup() }
}

describe('clientes y cuentas corrientes (§23)', () => {
  it('lista los clientes con su deuda y el encargado puede crear uno', async () => {
    const { fake, user } = setup('/clientes')
    const table = await screen.findByRole('table', { name: 'Clientes con cuenta corriente' })
    expect(within(table).getByRole('link', { name: 'Juana Ficticia' })).toBeInTheDocument()
    expect(within(table).getByText('Bloqueado')).toBeInTheDocument()
    expect(screen.getByText(/Deuda total: \$\s1\.500,00/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Buscar cliente'), 'bruno')
    expect(within(table).queryByText('Juana Ficticia')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(within(dialog).getByText('Escribí el nombre.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Carla Nueva')
    await user.type(within(dialog).getByLabelText(/^DNI o CUIT/), '30.111.222')
    await user.type(within(dialog).getByLabelText(/^Límite de crédito/), '20000')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fake.writes.some((w) => w.table === 'customers' && w.op === 'insert')).toBe(true))
    expect(fake.writes.find((w) => w.table === 'customers')?.payload).toMatchObject({
      name: 'Carla Nueva',
      document_number: '30111222',
      credit_limit: 20000,
      is_blocked: false,
    })
  })

  it('el empleado ve los clientes pero no los administra', async () => {
    setup('/clientes', 'staff')
    await screen.findByRole('table', { name: 'Clientes con cuenta corriente' })
    expect(screen.queryByRole('button', { name: 'Nuevo cliente' })).not.toBeInTheDocument()
  })

  it('cobra una parte de la deuda en la caja abierta', async () => {
    const { fake, user } = setup('/clientes/cus-1')
    expect(await screen.findByText(/Compra \(venta n\.º 7\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cobrar deuda' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar deuda de Juana Ficticia' })
    const amount = within(dialog).getByLabelText(/^Monto/)
    await user.clear(amount)
    await user.type(amount, '2000')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('no puede superar la deuda')

    fake.setRpcResult('register_customer_payment', { id: 'pay-1' })
    await user.clear(amount)
    await user.type(amount, '1000')
    await user.type(within(dialog).getByLabelText(/^Recibido/), '1500')
    expect(within(dialog).getByRole('status')).toHaveTextContent(/Vuelto: \$\s500,00/)
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledWith('register_customer_payment', expect.anything()))
    const [, params] = fake.rpc.mock.calls.find(([n]) => n === 'register_customer_payment') as [string, Record<string, unknown>]
    expect(params).toMatchObject({
      p_cash_session_id: 'ses-1',
      p_customer_id: 'cus-1',
      p_payment_method_id: 'pm-cash',
      p_amount: 1000,
      p_tendered_amount: 1500,
    })
  })

  it('en la caja, vender a cuenta corriente pide el cliente y usa register_account_sale', async () => {
    const { fake, user } = setup('/caja', 'staff')
    await user.click(await screen.findByRole('button', { name: 'Vender en Caja 1' }))
    await user.type(await screen.findByLabelText('Código o producto'), '7790000000017{Enter}')
    await screen.findByRole('table', { name: 'Productos del carrito' })
    await user.type(screen.getByLabelText('Código o producto'), '{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar' })
    await user.click(within(dialog).getByRole('button', { name: 'Todo con Cuenta corriente' }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Elegí el cliente de la cuenta corriente.')
    expect(fake.rpc).not.toHaveBeenCalled()

    // Límite superado: la empleada recibe el aviso de pedir la autorización.
    fake.setRpcResult('register_account_sale', null, { code: 'P0001', message: 'CREDIT_LIMIT_EXCEEDED' })
    await user.selectOptions(within(dialog).getByLabelText('Cliente'), 'cus-1')
    expect(within(dialog).getByText(/Debe \$\s1\.500,00/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    expect(await within(dialog).findByText(/supera el límite de crédito.*Pedile que la autorice/)).toBeInTheDocument()

    fake.setRpcResult('register_account_sale', { id: 'sale-1', sale_number: 20, total_amount: 1000, created_at: '2026-11-24T15:00:00Z' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }))
    const ticket = await screen.findByRole('dialog', { name: 'Venta n.º 20 registrada' })
    expect(ticket).toHaveTextContent('Cuenta corriente · Juana Ficticia')
    const [name, params] = fake.rpc.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(name).toBe('register_account_sale')
    expect(params).toMatchObject({
      p_cash_session_id: 'ses-1',
      p_customer_id: 'cus-1',
      p_allow_over_limit: false,
      p_payments: [{ payment_method_id: 'pm-account', amount: 1000, tendered_amount: null, reference: null }],
    })
  })
})
