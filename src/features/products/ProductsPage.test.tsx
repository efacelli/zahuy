import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { todayInAppTimeZone } from '../../lib/dates'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const TODAY = todayInAppTimeZone()

/** Filas ficticias con la forma de v_product_list (contrato §7.3). */
function row(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    sku: 'SKU-1',
    barcode: null,
    name: 'Producto',
    category_id: '11111111-1111-4111-8111-111111111111',
    category_name: 'Lácteos',
    brand_id: '22222222-2222-4222-8222-222222222222',
    brand_name: 'Marca',
    supplier_id: null,
    supplier_name: null,
    sale_unit: 'unit',
    cost_price: 450.5,
    sale_price: 700,
    sale_price_with_vat: 847,
    vat_rate: 21,
    boxes_quantity: 0,
    units_per_box: 12,
    min_stock: 10,
    is_active: true,
    stock_quantity: 55,
    next_expires_on: null,
    next_expiry_status: 'no_expiry',
    active_batches_count: 1,
    is_low_stock: false,
    units_in_boxes: 0,
    loose_units: 55,
    has_box_mismatch: false,
    ...overrides,
  }
}

function setup(rows: Record<string, unknown>[], path = '/productos') {
  const fake = createFakeSupabase(fakeSession())
  fake.setTable('v_product_list', rows)
  fake.setTable('categories', [])
  fake.setTable('suppliers', [])
  const router = renderApp(path, fake.client)
  return { fake, router, user: userEvent.setup() }
}

describe('Listado de productos', () => {
  it('muestra las columnas del pedido, con proveedor vacío y stock bajo', async () => {
    setup([
      row({ sku: 'YOG-1', name: 'Yogur frutilla', barcode: '7790001234567', supplier_name: 'Distribuidora Norte' }),
      row({ sku: 'ARR-1', name: 'Arroz 1 kg', stock_quantity: 3, is_low_stock: true }),
    ])
    const table = await screen.findByRole('table', { name: 'Listado de productos' })
    for (const header of ['SKU', 'Código de barras', 'Nombre', 'Marca', 'Categoría', 'Proveedor', 'Costo s/IVA', 'Precio s/IVA', 'Precio final', 'IVA', 'Stock', 'Cajas', 'Próximo vencimiento', 'Estado']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${header}`) })).toBeInTheDocument()
    }
    expect(within(table).getByText('Yogur frutilla')).toBeInTheDocument()
    expect(within(table).getByText('Distribuidora Norte')).toBeInTheDocument()
    expect(within(table).getByText('Sin proveedor')).toBeInTheDocument()
    expect(within(table).getByText('Stock bajo')).toBeInTheDocument()
    expect(within(table).getByText('3 u.')).toBeInTheDocument()
    expect(within(table).getAllByText('21%')).toHaveLength(2)
  })

  it('muestra el precio final que calcula la base', async () => {
    setup([row({ name: 'Leche', sale_price: 1000, sale_price_with_vat: 1210 })])
    const table = await screen.findByRole('table')
    expect(within(table).getByText(/1\.210,00/)).toBeInTheDocument()
  })

  it('muestra el stock como sueltas + cajas (contrato v0.4.0 §7.2)', async () => {
    setup([
      row({ name: 'Yogur', stock_quantity: 84, boxes_quantity: 5, units_per_box: 12, units_in_boxes: 60, loose_units: 24 }),
    ])
    expect(await screen.findByText('84 u.')).toBeInTheDocument()
    expect(screen.getByText(/24 u\. sueltas \+ 5 cajas de 12/)).toBeInTheDocument()
  })

  it('avisa cuando las cajas contadas superan el stock', async () => {
    setup([
      row({ name: 'Arroz', stock_quantity: 50, boxes_quantity: 8, units_per_box: 12, units_in_boxes: 96, loose_units: -46, has_box_mismatch: true }),
    ])
    expect(await screen.findByText('Revisar cajas')).toBeInTheDocument()
    expect(screen.queryByText(/sueltas/)).not.toBeInTheDocument()
  })

  it('muestra el próximo vencimiento con contador de días y nivel de alerta', async () => {
    setup([
      row({ name: 'Leche', next_expires_on: addDays(TODAY, 5), next_expiry_status: 'expires_urgent' }),
      row({ name: 'Queso', next_expires_on: addDays(TODAY, -2), next_expiry_status: 'expired' }),
      row({ name: 'Fideos', next_expires_on: null, next_expiry_status: 'no_expiry' }),
    ])
    expect(await screen.findByText('vence en 5 días')).toBeInTheDocument()
    expect(screen.getByText('venció hace 2 días')).toBeInTheDocument()
    expect(screen.getByText('No vence')).toBeInTheDocument()
    // El nivel también se anuncia con texto, no solo con color.
    expect(screen.getByText(/Vencimiento urgente:/)).toBeInTheDocument()
    expect(screen.getByText(/Vencido:/)).toBeInTheDocument()
  })

  it('los filtros se guardan en la URL y vuelven a la página 1', async () => {
    const { user, router } = setup([row({})], '/productos?pagina=2')
    await screen.findByRole('table')
    await user.click(screen.getByLabelText('Solo stock bajo'))
    expect(router.state.location.search).toBe('?stock=bajo')
    await user.selectOptions(screen.getByLabelText('Vencimiento'), 'urgente')
    expect(router.state.location.search).toBe('?stock=bajo&vence=urgente')
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(router.state.location.search).toBe('')
  })

  it('la búsqueda se aplica al dejar de escribir', async () => {
    const { user, router } = setup([row({})])
    await screen.findByRole('table')
    await user.type(screen.getByRole('searchbox'), 'yogur')
    expect(router.state.location.search).toBe('')
    await screen.findByDisplayValue('yogur')
    await new Promise((r) => setTimeout(r, 400))
    expect(router.state.location.search).toBe('?q=yogur')
  })

  it('ordenar por una columna actualiza la URL', async () => {
    const { user, router } = setup([row({})])
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: /^Stock/ }))
    expect(router.state.location.search).toBe('?orden=stock_quantity')
    await user.click(screen.getByRole('button', { name: /^Stock/ }))
    expect(router.state.location.search).toBe('?orden=stock_quantity&dir=desc')
  })

  it('pagina desde la base', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ name: `Producto ${i}` }))
    const { user, router } = setup(rows)
    expect(await screen.findByText('Mostrando 1–25 de 30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(router.state.location.search).toBe('?pagina=2')
  })

  it('estado vacío sin productos y con filtros', async () => {
    setup([])
    expect(await screen.findByText('Todavía no hay productos')).toBeInTheDocument()
  })

  it('si la vista todavía no existe, lo avisa', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('v_product_list', null, { code: 'PGRST205', message: 'Could not find the table' })
    renderApp('/productos', fake.client)
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
  })
})

describe('Exportar a Excel', () => {
  it('arma un CSV que Excel en español abre directo', async () => {
    const { productsToCsv, csvCell } = await import('./export-csv')
    const csv = productsToCsv([
      row({ sku: '000123', barcode: '7790001234567', name: 'Yerba; "suave" 1 kg', stock_quantity: 2.5, next_expires_on: '2026-12-31', next_expiry_status: 'expires_upcoming' }),
    ] as never)
    expect(csv.startsWith('﻿SKU;Código de barras;Nombre')).toBe(true)
    const line = csv.split('\r\n')[1]!
    expect(line).toContain('="000123";="7790001234567";"Yerba; ""suave"" 1 kg";Marca;Lácteos;;Unidad;450,50;700,0000;21,0;847,00;2,5;')
    expect(line).toContain('31/12/2026')
    // Una celda que empieza con = no se ejecuta como fórmula.
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-5')).toBe("'-5")
  })

  it('el botón baja todo el listado filtrado', async () => {
    const created: Blob[] = []
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = (b: Blob) => {
      created.push(b)
      return 'blob:x'
    }
    URL.revokeObjectURL = () => {}
    try {
      const { user } = setup([row({ name: 'Leche' }), row({ name: 'Queso' })])
      await screen.findByText('Leche')
      await user.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
      expect(await screen.findByText('Se exportaron 2 productos.')).toBeInTheDocument()
      expect(created).toHaveLength(1)
      const text = await created[0]!.text()
      expect(text).toContain('Leche')
      expect(text).toContain('Queso')
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })
})
