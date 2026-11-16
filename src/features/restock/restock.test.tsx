import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { boxesToOrder, groupBySupplier, quantityToOrder, type RestockRow } from './restock-api'

/** Filas ficticias con la forma de v_product_list (contrato §7.3). */
function row(overrides: Partial<RestockRow> & Record<string, unknown>): RestockRow & Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    sku: '000001',
    name: 'Producto',
    brand_name: 'Marca',
    supplier_id: 'sup-a',
    supplier_name: 'Distribuidora Andes',
    sale_unit: 'unit',
    units_per_box: 12,
    min_stock: 10,
    stock_quantity: 4,
    is_active: true,
    is_low_stock: true,
    ...overrides,
  }
}

describe('reposición (reglas puras)', () => {
  it('pide lo que falta para llegar al mínimo', () => {
    expect(quantityToOrder({ min_stock: 10, stock_quantity: 4, sale_unit: 'unit' })).toBe(6)
    expect(quantityToOrder({ min_stock: 10, stock_quantity: 10, sale_unit: 'unit' })).toBe(0)
    // Un stock fraccionario en unidades enteras redondea hacia arriba.
    expect(quantityToOrder({ min_stock: 10, stock_quantity: 3.5, sale_unit: 'unit' })).toBe(7)
    // Por peso, con decimales.
    expect(quantityToOrder({ min_stock: 5, stock_quantity: 1.25, sale_unit: 'kg' })).toBe(3.75)
  })

  it('cajas que cubren lo que falta', () => {
    expect(boxesToOrder(13, { units_per_box: 12, sale_unit: 'unit' })).toBe(2)
    expect(boxesToOrder(12, { units_per_box: 12, sale_unit: 'unit' })).toBe(1)
    expect(boxesToOrder(0, { units_per_box: 12, sale_unit: 'unit' })).toBeNull()
    expect(boxesToOrder(5, { units_per_box: 1, sale_unit: 'unit' })).toBeNull()
    expect(boxesToOrder(2.5, { units_per_box: 12, sale_unit: 'kg' })).toBeNull()
  })

  it('agrupa por proveedor, alfabético y "Sin proveedor" al final', () => {
    const groups = groupBySupplier([
      row({ name: 'Yerba', supplier_id: null, supplier_name: null }),
      row({ name: 'Fideos', supplier_id: 'sup-z', supplier_name: 'Zeta SA' }),
      row({ name: 'Arroz' }),
      row({ name: 'Aceite' }),
    ])
    expect(groups.map((g) => g.supplierName)).toEqual(['Distribuidora Andes', 'Zeta SA', 'Sin proveedor'])
    expect(groups[0]!.items.map((i) => i.name)).toEqual(['Aceite', 'Arroz'])
  })
})

function setup(rows: Record<string, unknown>[], role: 'manager' | 'staff' = 'staff') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('v_product_list', rows)
  renderApp('/reposicion', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('pantalla de reposición', () => {
  it('lista por proveedor lo que hay que pedir, sin productos sin mínimo', async () => {
    setup([
      row({ name: 'Arroz 1 kg', min_stock: 30, stock_quantity: 5 }),
      row({ name: 'Detergente', supplier_id: null, supplier_name: null, min_stock: 6, stock_quantity: 6 }),
      // Sin mínimo configurado: con stock 0 figura como stock bajo, pero no se pide.
      row({ name: 'Producto sin mínimo', min_stock: 0, stock_quantity: 0 }),
    ])
    const andes = await screen.findByRole('table', { name: 'Reponer de Distribuidora Andes' })
    const arroz = within(andes).getByText('Arroz 1 kg').closest('tr')!
    expect(arroz).toHaveTextContent('25')
    expect(arroz).toHaveTextContent('3 cajas de 12')

    const none = screen.getByRole('table', { name: 'Reponer de Sin proveedor' })
    expect(within(none).getByText('En el mínimo')).toBeInTheDocument()
    expect(screen.queryByText('Producto sin mínimo')).not.toBeInTheDocument()
    expect(screen.getByText('2 productos para reponer')).toBeInTheDocument()
  })

  it('filtra por proveedor e imprime', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { user } = setup([row({ name: 'Arroz' }), row({ name: 'Fideos', supplier_id: 'sup-z', supplier_name: 'Zeta SA' })])
    await screen.findByRole('table', { name: 'Reponer de Zeta SA' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Proveedor' }), 'sup-z')
    expect(screen.queryByRole('table', { name: 'Reponer de Distribuidora Andes' })).not.toBeInTheDocument()
    expect(screen.getByText('1 producto para reponer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Imprimir lista' }))
    expect(print).toHaveBeenCalled()
    print.mockRestore()
  })

  it('estado vacío', async () => {
    setup([])
    expect(await screen.findByText('No hay nada para reponer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir lista' })).toBeDisabled()
  })
})
