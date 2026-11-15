import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { todayInAppTimeZone } from '../../lib/dates'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { applyHistoryParams, type HistoryQuery } from './movements-api'
import { occurredAtParam, receiveQuantity, validateMovement, validateReceive, emptyReceiveForm } from './movement-forms'

const TODAY = todayInAppTimeZone()
const PRODUCT = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sku: '000001', name: 'Yogur frutilla', sale_unit: 'unit', units_per_box: 12, is_active: true }
const CHEESE = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sku: '000002', name: 'Queso cremoso', sale_unit: 'kg', units_per_box: 1, is_active: true }

describe('validaciones de los formularios', () => {
  it('ingreso: cantidad según la unidad, cajas enteras y vencimiento obligatorio', () => {
    const base = { ...emptyReceiveForm(TODAY), quantity: '3', expires_on: '2026-12-01' }
    expect(validateReceive(base, 'unit', TODAY)).toEqual({})
    expect(validateReceive({ ...base, expires_on: '' }, 'unit', TODAY).expires_on).toBe('Indicá la fecha de vencimiento.')
    expect(validateReceive({ ...base, quantity: '1,5' }, 'unit', TODAY).quantity).toMatch(/entera/)
    expect(validateReceive({ ...base, quantity: '1,5' }, 'kg', TODAY)).toEqual({})
    expect(validateReceive({ ...base, quantity: '1,5', mode: 'boxes' }, 'kg', TODAY).quantity).toMatch(/cajas debe ser entera/)
    expect(validateReceive({ ...base, received_on: '2999-01-01' }, 'unit', TODAY).received_on).toMatch(/futura/)
  })

  it('ingreso por cajas se convierte con las unidades por caja', () => {
    expect(receiveQuantity({ ...emptyReceiveForm(TODAY), quantity: '3', mode: 'boxes' }, 12)).toBe(36)
    expect(receiveQuantity({ ...emptyReceiveForm(TODAY), quantity: '3', mode: 'units' }, 12)).toBe(3)
  })

  it('salida: motivo obligatorio salvo "salida", y hasta 7 días de atraso', () => {
    const now = new Date('2026-11-15T12:00:00Z')
    const base = { movement_type: 'shrinkage' as const, quantity: '2', reason: 'Vencido', notes: '', occurred_at: '' }
    expect(validateMovement(base, 'unit', now)).toEqual({})
    expect(validateMovement({ ...base, reason: ' ' }, 'unit', now).reason).toBe('Indicá el motivo.')
    expect(validateMovement({ ...base, movement_type: 'exit', reason: '' }, 'unit', now)).toEqual({})
    expect(validateMovement({ ...base, occurred_at: '2026-11-01T10:00' }, 'unit', now).occurred_at).toMatch(/7 días/)
    expect(validateMovement({ ...base, occurred_at: '2026-12-01T10:00' }, 'unit', now).occurred_at).toMatch(/futura/)
  })

  it('fecha vacía = la base usa now()', () => {
    expect(occurredAtParam('')).toBeNull()
    expect(occurredAtParam('2026-11-15T10:30')).toMatch(/^2026-11-15T/)
  })
})

describe('consulta del historial', () => {
  it('ordena por fecha descendente, filtra por tipo y pagina', () => {
    const calls: unknown[][] = []
    const q: HistoryQuery = {
      eq: (c, v) => (calls.push(['eq', c, v]), q),
      order: (c, o) => (calls.push(['order', c, o]), q),
      range: (f, t) => (calls.push(['range', f, t]), Promise.resolve({ data: [], error: null, count: 0 })),
    }
    void applyHistoryParams(q, { type: 'shrinkage', page: 2 })
    expect(calls).toEqual([
      ['eq', 'movement_type', 'shrinkage'],
      ['order', 'occurred_at', { ascending: false }],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: true }],
      ['range', 25, 49],
    ])
  })
})

function historyRow(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    movement_type: 'entry',
    quantity: 30,
    signed_quantity: 30,
    batch_quantity_after: 30,
    reason: null,
    notes: null,
    occurred_at: '2026-11-14T13:00:00Z',
    reverses_movement_id: null,
    batch: { batch_number: 'L-01', expires_on: '2026-12-15', product: { sku: '000001', name: 'Yogur frutilla', sale_unit: 'unit' } },
    author: { full_name: 'Encargado de prueba' },
    ...overrides,
  }
}

function setup(role: 'staff' | 'manager', history: Record<string, unknown>[] = []) {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('stock_movements', history)
  fake.setTable('products', [PRODUCT, CHEESE])
  renderApp('/movimientos', fake.client)
  return { fake, user: userEvent.setup() }
}

async function pickProduct(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(name) }))
}

describe('pantalla de Movimientos', () => {
  it('muestra el historial con producto, lote, signo, saldo y usuario', async () => {
    setup('manager', [
      historyRow({}),
      historyRow({ movement_type: 'shrinkage', quantity: 2, signed_quantity: -2, batch_quantity_after: 28, reason: 'Vencido' }),
    ])
    const table = await screen.findByRole('table', { name: 'Historial de movimientos' })
    expect(within(table).getAllByText('Yogur frutilla')).toHaveLength(2)
    expect(within(table).getByText('+30 u.')).toBeInTheDocument()
    expect(within(table).getByText('−2 u.')).toBeInTheDocument()
    expect(within(table).getByText('Vencido')).toBeInTheDocument()
    expect(within(table).getAllByText('Encargado de prueba')).toHaveLength(2)
  })

  it('el empleado registra ingresos y consumo interno, pero no anula', async () => {
    setup('staff', [historyRow({})])
    await screen.findByRole('table')
    expect(screen.getByRole('button', { name: '+ Ingreso de mercadería' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Consumo interno' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Anular/ })).not.toBeInTheDocument()
  })

  it('el encargado puede anular, con motivo obligatorio', async () => {
    const { user, fake } = setup('manager', [historyRow({ id: '11111111-2222-4333-8444-555555555555' })])
    fake.setRpcResult('reverse_stock_movement', { id: 'r1' })
    await user.click(await screen.findByRole('button', { name: /Anular movimiento/ }))
    const dialog = screen.getByRole('dialog', { name: 'Anular movimiento' })
    await user.click(within(dialog).getByRole('button', { name: 'Anular' }))
    expect(within(dialog).getByText('Indicá por qué se anula.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Motivo/), 'Cargado dos veces')
    await user.click(within(dialog).getByRole('button', { name: 'Anular' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalled())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('reverse_stock_movement')
    expect(params).toMatchObject({ p_movement_id: '11111111-2222-4333-8444-555555555555', p_reason: 'Cargado dos veces' })
  })

  it('ingreso por cajas: convierte, pide vencimiento, confirma y llama a receive_stock', async () => {
    const { user, fake } = setup('staff')
    fake.setRpcResult('receive_stock', { id: 'm1' })
    await user.click(await screen.findByRole('button', { name: '+ Ingreso de mercadería' }))
    await pickProduct(user, 'Yogur frutilla')
    await user.click(screen.getByLabelText('Cajas'))
    await user.type(screen.getByLabelText(/^Cantidad de cajas/), '3')
    expect(screen.getByText('= 36 u. (cajas de 12)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(screen.getByText('Indicá la fecha de vencimiento.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Vencimiento/), '2026-12-15')
    await user.type(screen.getByLabelText(/^Observaciones/), 'Factura A 0008-123')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))

    const dialog = screen.getByRole('dialog', { name: 'Confirmar ingreso' })
    expect(within(dialog).getByText('36 u.')).toBeInTheDocument()
    expect(fake.rpc).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Registrar ingreso' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('receive_stock')
    expect(params).toMatchObject({
      p_product_id: PRODUCT.id,
      p_quantity: 36,
      p_expires_on: '2026-12-15',
      p_received_on: TODAY,
      p_notes: 'Factura A 0008-123',
      p_batch_number: null,
    })
    expect(await screen.findByText('Ingresaron 36 u. de "Yogur frutilla".')).toBeInTheDocument()
  })

  it('el empleado solo puede elegir consumo interno', async () => {
    const { user } = setup('staff')
    await user.click(await screen.findByRole('button', { name: 'Consumo interno' }))
    const dialog = screen.getByRole('dialog')
    const options = within(within(dialog).getByLabelText(/^Tipo de movimiento/)).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Consumo interno (resta)'])
  })

  it('salida por producto: motivo obligatorio y la base reparte entre lotes', async () => {
    const { user, fake } = setup('manager')
    fake.setRpcResult('register_product_movement', [{ id: 'm1' }, { id: 'm2' }])
    await user.click(await screen.findByRole('button', { name: 'Salida o ajuste' }))
    await pickProduct(user, 'Queso cremoso')
    await user.selectOptions(within(screen.getByRole('dialog')).getByLabelText(/^Tipo de movimiento/), 'shrinkage')
    await user.type(screen.getByLabelText(/^Cantidad/), '1,250')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(screen.getByText('Indicá el motivo.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Motivo/), 'Vencido, se tira')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))

    const dialog = screen.getByRole('dialog', { name: 'Confirmar: merma' })
    expect(within(dialog).getByText(/descuenta del lote que vence primero/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Registrar merma' }))
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledOnce())
    const [name, params] = fake.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('register_product_movement')
    expect(params).toMatchObject({
      p_product_id: CHEESE.id,
      p_movement_type: 'shrinkage',
      p_quantity: 1.25,
      p_reason: 'Vencido, se tira',
      p_occurred_at: null,
    })
    expect(await screen.findByText('Merma: 1,25 kg de "Queso cremoso" (2 lotes).')).toBeInTheDocument()
  })

  it('muestra el stock insuficiente que devuelve la base sin perder lo cargado', async () => {
    const { user, fake } = setup('manager')
    fake.setRpcResult('register_product_movement', null, { code: 'P0001', message: 'INSUFFICIENT_STOCK' })
    await user.click(await screen.findByRole('button', { name: 'Salida o ajuste' }))
    await pickProduct(user, 'Yogur frutilla')
    await user.type(screen.getByLabelText(/^Cantidad/), '500')
    await user.click(screen.getByRole('button', { name: 'Revisar' }))
    await user.click(screen.getByRole('button', { name: /^Registrar/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay stock suficiente')
    expect(screen.getByLabelText(/^Cantidad/)).toHaveValue('500')
  })

  it('si la tabla de movimientos no existe, lo avisa', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('stock_movements', null, { code: 'PGRST200', message: 'Could not find a relationship' })
    renderApp('/movimientos', fake.client)
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
  })
})
