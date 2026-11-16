import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import type { ShiftRow } from '../shifts/shifts-api'
import { lastDays, localDay, summarize } from './finance-api'

const TODAY = new Date('2026-11-16T15:00:00Z') // 12:00 en Buenos Aires

const shift = (overrides: Partial<ShiftRow>): ShiftRow => ({
  cash_session_id: 's',
  cash_register_name: 'Caja 1',
  status: 'closed',
  opened_at: '2026-11-16T12:00:00Z',
  closed_at: '2026-11-16T22:00:00Z',
  opening_amount: 5000,
  sales_count: 0,
  sales_total: 0,
  voided_count: 0,
  cash_collected: 0,
  rounding_total: 0,
  expected_cash: 5000,
  counted_cash: 5000,
  difference: 0,
  opener: null,
  closer: null,
  ...overrides,
})

describe('finanzas (reglas puras)', () => {
  it('días locales de Buenos Aires', () => {
    // 01:30 UTC del 16 todavía es el 15 en Argentina.
    expect(localDay('2026-11-16T01:30:00Z')).toBe('2026-11-15')
    expect(lastDays(3, TODAY)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16'])
  })

  it('agrupa ventas por día, suma medios y diferencias', () => {
    const data = summarize(
      [
        shift({ cash_session_id: 'a', opened_at: '2026-11-15T12:00:00Z', sales_total: 5990.25, sales_count: 1, rounding_total: 9.75, difference: -50 }),
        shift({ cash_session_id: 'b', opened_at: '2026-11-16T12:00:00Z', sales_total: 1000, sales_count: 2, difference: 20 }),
        shift({ cash_session_id: 'c', status: 'open', sales_total: 500, sales_count: 1, difference: null, rounding_total: null }),
      ],
      [
        { payment_method_name: 'Efectivo', amount_total: 6000, payments_count: 1 },
        { payment_method_name: 'Efectivo', amount_total: 1000, payments_count: 2 },
        { payment_method_name: 'Débito', amount_total: 500, payments_count: 1 },
      ],
      7,
      TODAY,
    )
    expect(data.days).toHaveLength(7)
    expect(data.days.at(-2)).toEqual({ day: '2026-11-15', total: 5990.25, count: 1 })
    expect(data.days.at(-1)).toEqual({ day: '2026-11-16', total: 1500, count: 3 })
    expect(data.salesTotal).toBe(7490.25)
    expect(data.salesCount).toBe(4)
    expect(data.differenceTotal).toBe(-30)
    expect(data.roundingTotal).toBe(9.75)
    expect(data.openSessions).toBe(1)
    expect(data.methods).toEqual([
      { name: 'Efectivo', total: 7000, count: 3 },
      { name: 'Débito', total: 500, count: 1 },
    ])
    expect(data.closings.map((c) => c.difference)).toEqual([-50, 20])
  })
})

describe('dashboard: ventas y caja', () => {
  function setup() {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    fake.setTable('v_inventory_summary', [])
    fake.setTable('v_cash_session_summary', [
      shift({ cash_session_id: 'a', opened_at: new Date().toISOString(), sales_total: 5990.25, sales_count: 1, difference: -50 }),
    ] as unknown as Record<string, unknown>[])
    fake.setTable('v_cash_session_payments', [{ payment_method_name: 'Efectivo', amount_total: 6000, payments_count: 1 }])
    renderApp('/', fake.client)
    return userEvent.setup()
  }

  it('muestra métricas, gráficos y tabla accesible', async () => {
    const user = setup()
    const section = await screen.findByRole('region', { name: 'Ventas y caja' })
    expect(await within(section).findByText('Ticket promedio')).toBeInTheDocument()
    expect(within(section).getAllByText(/5\.990,25/).length).toBeGreaterThan(0)
    expect(within(section).getByText('Faltante $ 50,00', { normalizer: (t) => t.replace(/\s+/g, ' ') })).toBeInTheDocument()
    expect(within(section).getByText('Efectivo')).toBeInTheDocument()

    // El período se elige arriba y queda marcado.
    const seven = within(section).getByRole('button', { name: 'Últimos 7 días' })
    await user.click(seven)
    expect(seven).toHaveAttribute('aria-pressed', 'true')

    // Cada barra se puede leer con el teclado.
    expect(within(section).getAllByRole('button', { name: /ventas?$/ }).length).toBe(7)
  })
})
