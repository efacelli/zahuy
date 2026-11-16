import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { differenceKind, normalizeShift, type ShiftRow } from './shifts-api'

const CLOSED: ShiftRow = {
  cash_session_id: 'ses-1',
  cash_register_name: 'Caja 1',
  status: 'closed',
  opened_at: '2026-11-15T12:00:00Z',
  closed_at: '2026-11-15T22:00:00Z',
  // numeric puede llegar como texto: se normaliza.
  opening_amount: '5000' as unknown as number,
  sales_count: 1,
  sales_total: 5990.25,
  voided_count: 0,
  cash_collected: 6000,
  rounding_total: 9.75,
  expected_cash: 11000,
  counted_cash: 10950,
  difference: -50,
  opener: { full_name: 'Ana Cajera' },
  closer: { full_name: 'Beto Encargado' },
}
const OPEN: ShiftRow = {
  ...CLOSED,
  cash_session_id: 'ses-2',
  cash_register_name: 'Caja 2',
  status: 'open',
  closed_at: null,
  counted_cash: null,
  difference: null,
  closer: null,
}

function setup(rows: ShiftRow[], role: 'manager' | 'staff' = 'manager') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('v_cash_session_summary', rows as unknown as Record<string, unknown>[])
  fake.setTable('v_cash_session_payments', [
    { cash_session_id: 'ses-1', payment_method_id: 'pm-cash', payment_method_name: 'Efectivo', payments_count: 1, amount_total: '6000' },
    { cash_session_id: 'ses-1', payment_method_id: 'pm-debit', payment_method_name: 'Débito', payments_count: 2, amount_total: 3200 },
  ])
  renderApp('/turnos', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('turnos (reglas puras)', () => {
  it('faltante, sobrante o justo', () => {
    expect(differenceKind(-50)).toBe('short')
    expect(differenceKind(20)).toBe('over')
    expect(differenceKind(0)).toBe('exact')
    expect(differenceKind(0.001)).toBe('exact')
  })

  it('normaliza los importes', () => {
    expect(normalizeShift(CLOSED).opening_amount).toBe(5000)
    expect(normalizeShift(OPEN).counted_cash).toBeNull()
  })
})

describe('pantalla de turnos', () => {
  it('lista turnos con el arqueo y el faltante en texto', async () => {
    setup([OPEN, CLOSED])
    const closedRow = (await screen.findByText('Caja 1')).closest('tr')!
    expect(closedRow).toHaveTextContent('Ana Cajera')
    expect(closedRow).toHaveTextContent('Beto Encargado')
    expect(closedRow).toHaveTextContent(/11\.000,00/)
    expect(closedRow).toHaveTextContent(/Contado \$\s10\.950,00/)
    expect(within(closedRow).getByText(/Faltante/)).toHaveTextContent(/50,00/)
    const openRow = screen.getByText('Caja 2').closest('tr')!
    expect(within(openRow).getByText('Abierta')).toBeInTheDocument()
  })

  it('el detalle muestra lo cobrado por medio de pago', async () => {
    const { user } = setup([CLOSED])
    await user.click(await screen.findByRole('button', { name: /Ver turno de Caja 1/ }))
    const dialog = await screen.findByRole('dialog')
    const table = await within(dialog).findByRole('table', { name: 'Cobrado por medio de pago' })
    expect(table).toHaveTextContent('Efectivo')
    expect(table).toHaveTextContent(/6\.000,00/)
    expect(table).toHaveTextContent('Débito')
    expect(table).toHaveTextContent(/3\.200,00/)
  })

  it('estado vacío', async () => {
    setup([])
    expect(await screen.findByText('Todavía no hay turnos')).toBeInTheDocument()
  })

  it('el empleado no ve la sección', async () => {
    setup([CLOSED], 'staff')
    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Turnos de caja' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Turnos de caja' })).not.toBeInTheDocument()
  })
})
