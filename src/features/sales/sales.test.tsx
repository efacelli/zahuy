import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { canBeVoided, chargedAmount, toTicket, type SaleRow } from './sales-api'

const CASH = { name: 'Efectivo', is_cash: true, sort_order: 1 }
const DEBIT = { name: 'Débito', is_cash: false, sort_order: 2 }

function sale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: 'sale-14',
    sale_number: 14,
    created_at: '2026-11-15T22:17:00Z',
    status: 'completed',
    // PostgREST puede devolver numeric como texto: la API lo normaliza.
    total_amount: '5990.25' as unknown as number,
    rounding_amount: '9.75' as unknown as number,
    notes: null,
    voided_at: null,
    void_reason: null,
    cash_session: { status: 'open', cash_register: { name: 'Caja 1' } },
    seller: { full_name: 'Ana Cajera' },
    voider: null,
    sale_items: [
      { product_name: 'Leche entera', product_sku: '000002', quantity: 3, unit_price_with_vat: 1270.75, line_total: 3812.25, discount_percent: 0, discount_amount: 0 },
      { product_name: 'Agua mineral', product_sku: '000004', quantity: 2, unit_price_with_vat: 1089, line_total: 2178, discount_percent: 0, discount_amount: 0 },
    ],
    sale_payments: [{ amount: 6000, tendered_amount: 10000, reference: null, payment_method: CASH }],
    ...overrides,
  }
}

function setup(rows: SaleRow[], role: 'manager' | 'staff' = 'manager') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('sales', rows as unknown as Record<string, unknown>[])
  renderApp('/ventas', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('ventas (reglas puras)', () => {
  it('lo cobrado es la suma de los pagos; el ticket calcula el vuelto del efectivo', () => {
    const s = sale({
      total_amount: 5990.25,
      rounding_amount: 9.75,
      sale_payments: [
        { amount: 2000, tendered_amount: null, reference: '1234', payment_method: DEBIT },
        { amount: 4000, tendered_amount: 5000, reference: null, payment_method: CASH },
      ],
    })
    expect(chargedAmount(s)).toBe(6000)
    const ticket = toTicket(s)
    expect(ticket.tendered).toBe(5000)
    expect(ticket.change).toBe(1000)
    expect(ticket.registerName).toBe('Caja 1')
  })

  it('solo se anula una venta completada con la caja abierta', () => {
    expect(canBeVoided(sale())).toBe(true)
    expect(canBeVoided(sale({ status: 'voided' }))).toBe(false)
    expect(canBeVoided(sale({ cash_session: { status: 'closed', cash_register: { name: 'Caja 1' } } }))).toBe(false)
    // El empleado puede no leer la sesión (RLS): no se ofrece anular.
    expect(canBeVoided(sale({ cash_session: null }))).toBe(false)
  })
})

describe('pantalla de ventas', () => {
  it('lista las ventas con lo cobrado y el redondeo', async () => {
    setup([sale()])
    const row = (await screen.findByText('Ana Cajera')).closest('tr')!
    expect(row).toHaveTextContent('14')
    expect(row).toHaveTextContent('Caja 1')
    expect(row).toHaveTextContent(/5\.990,25/)
    expect(row).toHaveTextContent(/6\.000,00/)
    expect(row).toHaveTextContent(/Redondeo/)
    expect(row).toHaveTextContent('Efectivo')
    expect(within(row).getByText('Completada')).toBeInTheDocument()
  })

  it('estado vacío', async () => {
    setup([])
    expect(await screen.findByText('Todavía no hay ventas')).toBeInTheDocument()
  })

  it('el encargado anula con motivo y la clave de idempotencia', async () => {
    const { fake, user } = setup([sale()])
    fake.setRpcResult('void_sale', { id: 'sale-14', status: 'voided' })
    await user.click(await screen.findByRole('button', { name: 'Ver venta n.º 14' }))
    const dialog = await screen.findByRole('dialog', { name: 'Venta n.º 14' })
    expect(within(dialog).getByText('NO VÁLIDO COMO FACTURA')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Anular…' }))
    await user.click(within(dialog).getByRole('button', { name: 'Anular venta' }))
    expect(within(dialog).getByText('Indicá por qué se anula.')).toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Cliente se arrepintió')
    await user.click(within(dialog).getByRole('button', { name: 'Anular venta' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.rpc).toHaveBeenCalledWith('void_sale', {
      p_idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_sale_id: 'sale-14',
      p_reason: 'Cliente se arrepintió',
    })
  })

  it('muestra el error de la base sin cerrar el diálogo', async () => {
    const { fake, user } = setup([sale()])
    fake.setRpcResult('void_sale', null, { code: 'P0001', message: 'CASH_SESSION_CLOSED' })
    await user.click(await screen.findByRole('button', { name: 'Ver venta n.º 14' }))
    const dialog = await screen.findByRole('dialog', { name: 'Venta n.º 14' })
    await user.click(within(dialog).getByRole('button', { name: 'Anular…' }))
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), 'Error de carga')
    await user.click(within(dialog).getByRole('button', { name: 'Anular venta' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La caja ya se cerró')
  })

  it('con la caja cerrada no ofrece anular', async () => {
    const { user } = setup([sale({ cash_session: { status: 'closed', cash_register: { name: 'Caja 1' } } })])
    await user.click(await screen.findByRole('button', { name: 'Ver venta n.º 14' }))
    const dialog = await screen.findByRole('dialog', { name: 'Venta n.º 14' })
    expect(within(dialog).queryByRole('button', { name: 'Anular…' })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/ya se cerró/)).toBeInTheDocument()
  })

  it('el empleado ve el detalle y reimprime, pero no anula', async () => {
    const { user } = setup([sale()], 'staff')
    await user.click(await screen.findByRole('button', { name: 'Ver venta n.º 14' }))
    const dialog = await screen.findByRole('dialog', { name: 'Venta n.º 14' })
    expect(within(dialog).getByRole('button', { name: 'Imprimir ticket' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Anular…' })).not.toBeInTheDocument()
  })

  it('una venta anulada muestra quién, cuándo y por qué', async () => {
    const { user } = setup([
      sale({
        status: 'voided',
        voided_at: '2026-11-15T22:30:00Z',
        void_reason: 'Cobro duplicado',
        voider: { full_name: 'Encargado Uno' },
      }),
    ])
    await user.click(await screen.findByRole('button', { name: 'Ver venta n.º 14' }))
    const dialog = await screen.findByRole('dialog', { name: 'Venta n.º 14' })
    expect(within(dialog).getByText('Cobro duplicado')).toBeInTheDocument()
    expect(within(dialog).getByText(/por Encargado Uno/)).toBeInTheDocument()
    expect(within(dialog).getByText('VENTA ANULADA')).toBeInTheDocument()
  })
})
