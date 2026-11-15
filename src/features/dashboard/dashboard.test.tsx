import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const SUMMARY = {
  active_products: 742,
  low_stock_products: 12,
  expiring_products: 0,
  expired_batches: 3,
  stock_value_cost: 1250300.5,
  stock_value_sale: 2101450,
  shrinkage_quantity_month: 18.5,
  box_mismatch_products: 1,
}

function setup(summary: Record<string, unknown>[] | null, error: unknown = null) {
  const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
  fake.setTable('v_inventory_summary', summary, error)
  fake.setTable('stock_movements', [
    {
      id: 'm1',
      movement_type: 'shrinkage',
      quantity: 2,
      signed_quantity: -2,
      batch_quantity_after: 10,
      reason: 'Vencido',
      notes: null,
      occurred_at: '2026-11-14T13:00:00Z',
      reverses_movement_id: null,
      batch: { batch_number: 'L-01', expires_on: '2026-11-10', product: { sku: '000001', name: 'Yogur frutilla', sale_unit: 'unit' } },
      author: { full_name: 'Encargado de prueba' },
    },
  ])
  renderApp('/', fake.client)
}

describe('Dashboard', () => {
  it('muestra las métricas de la base con estado en texto y enlaces a la lista', async () => {
    setup([SUMMARY])
    const tiles = await screen.findByRole('region', { name: 'Resumen del inventario' })
    const lowStock = within(tiles).getByRole('heading', { name: 'Stock bajo' }).closest('article')!
    expect(within(lowStock).getByText('12')).toBeInTheDocument()
    expect(within(lowStock).getByText('Reponer')).toBeInTheDocument()
    expect(within(lowStock).getByRole('link')).toHaveAttribute('href', '/productos?stock=bajo')

    const expiring = within(tiles).getByRole('heading', { name: 'Por vencer' }).closest('article')!
    expect(within(expiring).getByText('En orden')).toBeInTheDocument()

    const expired = within(tiles).getByRole('heading', { name: 'Lotes vencidos con stock' }).closest('article')!
    expect(within(expired).getByText('Retirar')).toBeInTheDocument()
    expect(within(expired).getByRole('link')).toHaveAttribute('href', '/alertas?nivel=vencidos')

    expect(within(tiles).getByText(/1\.250\.300,50/)).toBeInTheDocument()
    expect(within(tiles).getByText(/2\.101\.450,00/)).toBeInTheDocument()
    expect(within(tiles).getByText('742')).toBeInTheDocument()
  })

  it('muestra los últimos movimientos', async () => {
    setup([SUMMARY])
    expect(await screen.findByText('Yogur frutilla')).toBeInTheDocument()
    expect(screen.getByText('−2 u.')).toBeInTheDocument()
  })

  it('si la base no devuelve filas (no es encargado), no inventa números', async () => {
    setup([])
    expect(await screen.findByText('Sin datos')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Resumen del inventario' })).not.toBeInTheDocument()
  })

  it('si la vista todavía no existe, lo avisa', async () => {
    setup(null, { code: 'PGRST205', message: 'Could not find the table' })
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
  })
})
