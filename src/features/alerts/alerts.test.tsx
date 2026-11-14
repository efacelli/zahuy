import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { todayInAppTimeZone } from '../../lib/dates'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import {
  DEFAULT_ALERT_PARAMS,
  applyAlertParams,
  parseAlertParams,
  serializeAlertParams,
  type AlertParams,
  type AlertQuery,
} from './alerts-api'

const CAT = '11111111-1111-4111-8111-111111111111'
const TODAY = todayInAppTimeZone()

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function recorder() {
  const calls: [string, ...unknown[]][] = []
  const q: AlertQuery = {
    in: (c, v) => (calls.push(['in', c, v]), q),
    eq: (c, v) => (calls.push(['eq', c, v]), q),
    or: (f) => (calls.push(['or', f]), q),
    order: (c, o) => (calls.push(['order', c, o]), q),
    range: (f, t) => (calls.push(['range', f, t]), Promise.resolve({ data: [], error: null, count: 0 })),
  }
  return { q, calls }
}

function run(p: Partial<AlertParams>) {
  const { q, calls } = recorder()
  void applyAlertParams(q, { ...DEFAULT_ALERT_PARAMS, ...p })
  return calls
}

describe('consulta de alertas (contrato v0.4.2 §7.1)', () => {
  it('por defecto: vencidos y por vencer, nunca agotados ni sin vencimiento, ordenados por vencimiento', () => {
    expect(run({})).toEqual([
      ['in', 'expiry_status', ['expired', 'expires_urgent', 'expires_soon', 'expires_upcoming']],
      ['order', 'expires_on', { ascending: true }],
      ['order', 'product_name', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['range', 0, 24],
    ])
  })

  it('filtra por nivel, categoría y texto', () => {
    expect(run({ level: 'vencidos' })[0]).toEqual(['in', 'expiry_status', ['expired']])
    expect(run({ level: 'urgentes' })[0]).toEqual(['in', 'expiry_status', ['expires_urgent']])
    expect(run({ level: 'proximos' })[0]).toEqual(['in', 'expiry_status', ['expires_soon', 'expires_upcoming']])
    expect(run({ categoryId: CAT })).toContainEqual(['eq', 'category_id', CAT])
    expect(run({ search: 'yogur, (x)' })).toContainEqual([
      'or',
      'product_name.ilike.%yogur x%,product_sku.ilike.%yogur x%,batch_number.ilike.%yogur x%',
    ])
  })

  it('los parámetros viajan en la URL e ignoran valores inválidos', () => {
    const p = parseAlertParams(new URLSearchParams(`nivel=urgentes&categoria=${CAT}&q=leche&pagina=2`))
    expect(p).toEqual({ level: 'urgentes', categoryId: CAT, search: 'leche', page: 2 })
    expect(serializeAlertParams(p).toString()).toBe(`nivel=urgentes&categoria=${CAT}&q=leche&pagina=2`)
    expect(parseAlertParams(new URLSearchParams('nivel=todo&categoria=x&pagina=-1'))).toEqual(DEFAULT_ALERT_PARAMS)
  })
})

function batch(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    product_id: crypto.randomUUID(),
    product_sku: '000001',
    product_name: 'Yogur frutilla',
    product_is_active: true,
    sale_unit: 'unit',
    category_id: CAT,
    category_name: 'Lácteos',
    batch_number: 'L-01',
    received_on: addDays(TODAY, -10),
    expires_on: addDays(TODAY, 5),
    quantity_available: 12,
    days_to_expiry: 5,
    expiry_status: 'expires_urgent',
    ...overrides,
  }
}

function setup(rows: Record<string, unknown>[], path = '/alertas') {
  const fake = createFakeSupabase(fakeSession(), { role: 'staff' })
  fake.setTable('v_batch_status', rows)
  fake.setTable('categories', [{ id: CAT, name: 'Lácteos', is_active: true }])
  const router = renderApp(path, fake.client)
  return { router, user: userEvent.setup() }
}

describe('pantalla de Alertas', () => {
  it('muestra producto, lote, disponible y el contador de días; cualquier empleado la ve', async () => {
    setup([
      batch({ product_name: 'Leche entera', batch_number: null, expires_on: addDays(TODAY, -2), days_to_expiry: -2, expiry_status: 'expired' }),
      batch({ product_name: 'Yogur frutilla' }),
    ])
    const table = await screen.findByRole('table', { name: 'Alertas de vencimiento' })
    expect(within(table).getByRole('link', { name: 'Leche entera' })).toHaveAttribute('href', '/productos?q=000001&estado=todos')
    expect(within(table).getByText('Sin número')).toBeInTheDocument()
    expect(within(table).getByText('venció hace 2 días')).toBeInTheDocument()
    expect(within(table).getByText('vence en 5 días')).toBeInTheDocument()
    expect(within(table).getAllByText('12 u.')).toHaveLength(2)
  })

  it('cambia de nivel desde los botones y lo guarda en la URL', async () => {
    const { user, router } = setup([batch({})])
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Vencidos' }))
    expect(router.state.location.search).toBe('?nivel=vencidos')
    expect(screen.getByRole('button', { name: 'Vencidos' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('busca al confirmar el texto', async () => {
    const { user, router } = setup([batch({})])
    await screen.findByRole('table')
    await user.type(screen.getByRole('searchbox'), 'yogur{Enter}')
    expect(router.state.location.search).toBe('?q=yogur')
  })

  it('sin alertas lo dice', async () => {
    setup([])
    expect(await screen.findByText('No hay alertas')).toBeInTheDocument()
  })

  it('si la vista todavía no existe, lo avisa', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('v_batch_status', null, { code: 'PGRST205', message: 'Could not find the table' })
    renderApp('/alertas', fake.client)
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
  })
})
