import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession, FAKE_USER_ID } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { changedFields, formatAuditValue, parseAuditParams, recordLabel } from './audit-api'

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const ROWS = [
  {
    id: 3,
    table_name: 'products',
    record_id: PRODUCT_ID,
    action: 'update',
    old_data: { sku: '000001', name: 'Yogur frutilla', sale_price: 1000, updated_at: 'a', boxes_quantity: 2 },
    new_data: { sku: '000001', name: 'Yogur frutilla', sale_price: 1100, updated_at: 'b', boxes_quantity: 5 },
    changed_by: FAKE_USER_ID,
    changed_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 2,
    table_name: 'expiry_alert_settings',
    record_id: 'cfg-1',
    action: 'delete',
    old_data: { category_id: 'c-1', urgent_days: 3 },
    new_data: null,
    changed_by: FAKE_USER_ID,
    changed_at: '2026-11-14T14:00:00Z',
  },
  {
    id: 1,
    table_name: 'categories',
    record_id: 'c-1',
    action: 'insert',
    old_data: null,
    new_data: { name: 'Lácteos' },
    changed_by: null,
    changed_at: '2026-11-14T13:00:00Z',
  },
]

describe('auditoría: presentación', () => {
  it('muestra solo los campos que cambiaron, sin las columnas de la base', () => {
    expect(changedFields(ROWS[0] as never)).toEqual([
      { field: 'boxes_quantity', before: 2, after: 5 },
      { field: 'sale_price', before: 1000, after: 1100 },
    ])
    expect(changedFields(ROWS[2] as never)).toEqual([])
  })

  it('nombra el registro con los datos guardados', () => {
    expect(recordLabel(ROWS[0] as never)).toBe('000001 · Yogur frutilla')
    expect(recordLabel(ROWS[1] as never)).toBe('Excepción de una categoría')
    expect(recordLabel(ROWS[2] as never)).toBe('Lácteos')
    expect(recordLabel({ table_name: 'product_batches', old_data: null, new_data: { batch_number: null } })).toBe('Lote sin número')
  })

  it('formatea valores y lee filtros de la URL', () => {
    expect(formatAuditValue(true)).toBe('sí')
    expect(formatAuditValue(null)).toBe('—')
    expect(parseAuditParams(new URLSearchParams('tabla=products&pagina=2'))).toEqual({ table: 'products', page: 2 })
    expect(parseAuditParams(new URLSearchParams('tabla=stock_movements&pagina=-1'))).toEqual({ table: null, page: 1 })
  })
})

describe('pantalla de Auditoría', () => {
  it('el dueño ve quién cambió qué', async () => {
    const fake = createFakeSupabase(fakeSession(), { role: 'admin' })
    fake.setTable('audit_log', ROWS)
    renderApp('/auditoria', fake.client)
    const table = await screen.findByRole('table', { name: 'Registro de auditoría' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Edición')
    expect(rows[0]).toHaveTextContent('cajas: 2 → 5')
    expect(rows[0]).toHaveTextContent('precio: 1000 → 1100')
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: '000001 · Yogur frutilla' })).toHaveAttribute(
      'href',
      `/productos/${PRODUCT_ID}`,
    )
    expect(await within(rows[0] as HTMLElement).findByText('Usuario de prueba')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Borrado')
    expect(rows[2]).toHaveTextContent('Sistema (carga inicial)')
    expect(screen.getByRole('link', { name: 'Auditoría' })).toHaveAttribute('href', '/auditoria')
  })

  it('el encargado no la ve ni puede entrar', async () => {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    renderApp('/auditoria', fake.client)
    expect(await screen.findByText('No tenés permiso para esta sección')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Auditoría' })).not.toBeInTheDocument()
  })
})
