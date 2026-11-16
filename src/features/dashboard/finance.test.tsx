import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import type { ShiftRow } from '../shifts/shifts-api'
import { lastDays, localDay, summarize, type SalesDailyRow } from './finance-api'

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

const daily = (overrides: Partial<SalesDailyRow>): SalesDailyRow => ({
  sale_date: '2026-11-16',
  sales_count: 0,
  total_amount: 0,
  net_amount: 0,
  cost_total: 0,
  gross_margin: 0,
  discount_total: 0,
  rounding_total: 0,
  ...overrides,
})

describe('finanzas (reglas puras)', () => {
  it('días locales de Buenos Aires', () => {
    // 01:30 UTC del 16 todavía es el 15 en Argentina.
    expect(localDay('2026-11-16T01:30:00Z')).toBe('2026-11-15')
    expect(lastDays(3, TODAY)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16'])
  })

  it('agrupa ventas y margen por día, suma medios y diferencias', () => {
    const data = summarize(
      [
        daily({ sale_date: '2026-11-15', sales_count: 1, total_amount: 5990.25, net_amount: 4950.62, cost_total: 3000, gross_margin: 1950.62, discount_total: 120, rounding_total: 9.75 }),
        daily({ sale_date: '2026-11-16', sales_count: 2, total_amount: 1500, net_amount: 1239.67, cost_total: 1400, gross_margin: -160.33 }),
        // Fuera del período: no cuenta.
        daily({ sale_date: '2026-11-01', sales_count: 9, total_amount: 99999, gross_margin: 99999 }),
      ],
      [
        { sale_date: '2026-11-15', payment_method_name: 'Efectivo', amount_total: 6000, payments_count: 1 },
        { sale_date: '2026-11-16', payment_method_name: 'Efectivo', amount_total: 1000, payments_count: 1 },
        { sale_date: '2026-11-16', payment_method_name: 'Débito', amount_total: 500, payments_count: 1 },
        { sale_date: '2026-11-01', payment_method_name: 'Débito', amount_total: 99999, payments_count: 9 },
      ],
      [
        shift({ cash_session_id: 'a', opened_at: '2026-11-15T12:00:00Z', difference: -50 }),
        shift({ cash_session_id: 'b', opened_at: '2026-11-16T12:00:00Z', difference: 20 }),
        shift({ cash_session_id: 'c', status: 'open', difference: null }),
      ],
      7,
      TODAY,
    )
    expect(data.days).toHaveLength(7)
    expect(data.days.at(-2)).toEqual({ day: '2026-11-15', total: 5990.25, count: 1, margin: 1950.62 })
    expect(data.days.at(-1)).toEqual({ day: '2026-11-16', total: 1500, count: 2, margin: -160.33 })
    expect(data.salesTotal).toBe(7490.25)
    expect(data.salesCount).toBe(3)
    expect(data.netTotal).toBe(6190.29)
    expect(data.costTotal).toBe(4400)
    expect(data.marginTotal).toBe(1790.29)
    expect(data.discountTotal).toBe(120)
    expect(data.roundingTotal).toBe(9.75)
    expect(data.differenceTotal).toBe(-30)
    expect(data.openSessions).toBe(1)
    expect(data.methods).toEqual([
      { name: 'Efectivo', total: 7000, count: 2 },
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
    const today = localDay(new Date())
    fake.setTable('v_sales_daily', [
      daily({ sale_date: today, sales_count: 1, total_amount: 5990.25, net_amount: 4950.62, cost_total: 3000, gross_margin: 1950.62, discount_total: 120 }),
    ] as unknown as Record<string, unknown>[])
    fake.setTable('v_sales_daily_payments', [{ sale_date: today, payment_method_name: 'Efectivo', amount_total: 6000, payments_count: 1 }])
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
    expect(within(section).getByText('Margen bruto')).toBeInTheDocument()
    expect(within(section).getAllByText(/1\.950,62/).length).toBeGreaterThan(0)
    expect(within(section).getByText(/39,4 % de lo vendido sin IVA/)).toBeInTheDocument()
    expect(within(section).getByText('Descuentos')).toBeInTheDocument()

    // El período se elige arriba y queda marcado.
    const seven = within(section).getByRole('button', { name: 'Últimos 7 días' })
    await user.click(seven)
    expect(seven).toHaveAttribute('aria-pressed', 'true')

    // Cada barra se puede leer con el teclado.
    expect(within(section).getAllByRole('button', { name: /^Ventas por día, .*ventas?$/ }).length).toBe(7)
    expect(within(section).getAllByRole('button', { name: /^Margen bruto por día, / }).length).toBe(7)
  })
})

describe('dashboard: más y menos vendidos (§17)', () => {
  const row = (o: Record<string, unknown>) => ({
    product_id: crypto.randomUUID(),
    sku: '000001',
    name: 'Producto',
    brand_name: 'Marca',
    sale_unit: 'unit',
    quantity_sold: '0',
    sales_count: 0,
    revenue_total: '0',
    gross_margin: '0',
    last_sold_at: null,
    stock_quantity: '0',
    product_created_at: '2026-01-01T00:00:00Z',
    ...o,
  })

  function setup(rpc: { data: unknown; error?: unknown }) {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    fake.setTable('v_inventory_summary', [])
    fake.setRpcResult('product_sales_ranking', rpc.data, rpc.error ?? null)
    renderApp('/', fake.client)
    return { fake, user: userEvent.setup() }
  }

  it('pide a la base el período, los filtros y el orden; muestra las tres listas', async () => {
    const { fake, user } = setup({
      data: [
        row({ name: 'Yerba 1 kg', quantity_sold: '12', revenue_total: '54000', gross_margin: '9000', stock_quantity: '3' }),
        row({ name: 'Lavandina 2 L', quantity_sold: '0', stock_quantity: '9', last_sold_at: null }),
      ],
    })
    const section = await screen.findByRole('region', { name: 'Productos' })
    const top = await within(section).findByRole('list', { name: 'Más vendidos' })
    expect(within(top).getByText('Yerba 1 kg')).toBeInTheDocument()
    expect(top).toHaveTextContent(/54\.000,00/)
    expect(within(section).getByRole('list', { name: 'Menos vendidos' })).toBeInTheDocument()
    expect(within(section).getAllByText(/Nunca se vendió/).length).toBeGreaterThan(0)

    const [name, params] = fake.rpc.mock.calls[0] as [string, { p_from: string; p_to: string }]
    expect(name).toBe('product_sales_ranking')
    expect(params.p_to).toBe(localDay(new Date()))
    expect(lastDays(30)[0]).toBe(params.p_from)
    const calls = fake.rpcFilters.map((c) => c.filters)
    const has = (f: unknown[]) => (c: unknown[][]) => c.some((x) => JSON.stringify(x) === JSON.stringify(f))
    const desc = calls.find(has(['order', 'revenue_total', { ascending: false }]))
    const asc = calls.find(has(['order', 'revenue_total', { ascending: true }]))
    const idle = calls.find(has(['eq', 'quantity_sold', 0]))
    expect(desc).toContainEqual(['gt', 'quantity_sold', 0])
    expect(asc).toContainEqual(['gt', 'quantity_sold', 0])
    expect(idle).toContainEqual(['gt', 'stock_quantity', 0])
    expect(idle).toContainEqual(['lt', 'product_created_at', `${params.p_from}T00:00:00-03:00`])

    // Por cantidad: la base ordena por quantity_sold y la lista muestra unidades.
    await user.click(within(section).getByRole('button', { name: 'Por cantidad' }))
    await waitFor(() =>
      expect(fake.rpcFilters.some((c) => c.filters.some((f) => f[0] === 'order' && f[1] === 'quantity_sold'))).toBe(true),
    )
    expect((await within(section).findAllByText('12 u.')).length).toBeGreaterThan(0)
  })

  it('sin la función en la base, lo avisa sin romper el dashboard', async () => {
    setup({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const section = await screen.findByRole('region', { name: 'Productos' })
    expect(await within(section).findByText('El ranking de productos todavía no está habilitado en la base.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Ventas y caja' })).toBeInTheDocument()
  })
})
