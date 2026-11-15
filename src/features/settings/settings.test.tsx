import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession, FAKE_USER_ID } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { validateAlertDays } from './alert-settings-api'

const DAIRY = '11111111-1111-4111-8111-111111111111'
const CLEANING = '22222222-2222-4222-8222-222222222222'
const DRINKS = '33333333-3333-4333-8333-333333333333'
const OTHER_USER = '44444444-4444-4444-8444-444444444444'

const CATEGORIES = [
  { id: DAIRY, name: 'Lácteos', is_active: true },
  { id: CLEANING, name: 'Limpieza', is_active: true },
  { id: DRINKS, name: 'Bebidas', is_active: true },
]
const SETTINGS = [
  { id: 'cfg-general', category_id: null, urgent_days: 7, soon_days: 15, notice_days: 30 },
  { id: 'cfg-cleaning', category_id: CLEANING, urgent_days: 30, soon_days: 60, notice_days: 90 },
]

function setup(role: 'admin' | 'manager' | 'staff') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('categories', CATEGORIES.map((c) => ({ ...c })))
  fake.setTable('expiry_alert_settings', SETTINGS.map((s) => ({ ...s })))
  if (role === 'admin') {
    fake.setTable('profiles', [
      { id: FAKE_USER_ID, full_name: 'Dueña de prueba', role: 'admin', is_active: true },
      { id: OTHER_USER, full_name: 'Empleado de prueba', role: 'staff', is_active: true },
    ])
  }
  renderApp('/configuracion', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('validación de días de alerta', () => {
  it('replica los CHECK de la base', () => {
    expect(validateAlertDays({ urgent_days: '7', soon_days: '15', notice_days: '30' }).days).toEqual({
      urgent_days: 7,
      soon_days: 15,
      notice_days: 30,
    })
    expect(validateAlertDays({ urgent_days: '0', soon_days: '0', notice_days: '0' }).days).not.toBeNull()
    expect(validateAlertDays({ urgent_days: '10', soon_days: '5', notice_days: '30' }).errors.soon_days).toMatch(/mayor/)
    expect(validateAlertDays({ urgent_days: '1', soon_days: '20', notice_days: '10' }).errors.notice_days).toMatch(/mayor/)
    expect(validateAlertDays({ urgent_days: '1', soon_days: '2', notice_days: '400' }).errors.notice_days).toMatch(/365/)
    expect(validateAlertDays({ urgent_days: '-1', soon_days: '2,5', notice_days: '' }).errors).toEqual({
      urgent_days: expect.any(String),
      soon_days: expect.any(String),
      notice_days: expect.any(String),
    })
  })
})

describe('Configuración: alertas de vencimiento', () => {
  it('el encargado ve la configuración general primero y las excepciones, sin usuarios', async () => {
    setup('manager')
    const table = await screen.findByRole('table', { name: 'Días de alerta por categoría' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('General (todas las categorías)')
    expect(rows[0]).toHaveTextContent('7 días')
    expect(rows[1]).toHaveTextContent('Limpieza')
    expect(rows[1]).toHaveTextContent('90 días')
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Usuarios' })).not.toBeInTheDocument()
  })

  it('edita la general validando el orden de los días', async () => {
    const { user, fake } = setup('manager')
    await user.click(await screen.findByRole('button', { name: 'Editar días de General (todas las categorías)' }))
    const dialog = screen.getByRole('dialog')
    const soon = within(dialog).getByLabelText(/^Vence pronto/)
    await user.clear(soon)
    await user.type(soon, '5')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(within(dialog).getByText(/igual o mayor que los días de "urgente"/)).toBeInTheDocument()
    expect(fake.writes).toHaveLength(0)
    await user.clear(soon)
    await user.type(soon, '10')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toEqual({
      table: 'expiry_alert_settings',
      op: 'update',
      payload: { urgent_days: 7, soon_days: 10, notice_days: 30 },
      filters: { id: 'cfg-general' },
    })
  })

  it('agrega una excepción solo para categorías que no tienen', async () => {
    const { user, fake } = setup('manager')
    await user.click(await screen.findByRole('button', { name: '+ Excepción por categoría' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva excepción por categoría' })
    const select = within(dialog).getByLabelText(/^Categoría/)
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elegí una categoría',
      'Lácteos',
      'Bebidas',
    ])
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(within(dialog).getByText('Elegí la categoría.')).toBeInTheDocument()
    await user.selectOptions(select, DAIRY)
    const urgent = within(dialog).getByLabelText(/^Vencimiento urgente/)
    await user.clear(urgent)
    await user.type(urgent, '3{Enter}')
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toMatchObject({
      table: 'expiry_alert_settings',
      op: 'insert',
      payload: { category_id: DAIRY, urgent_days: 3, soon_days: 15, notice_days: 30 },
    })
  })

  it('quitar una excepción pide confirmación y la borra', async () => {
    const { user, fake } = setup('manager')
    await user.click(await screen.findByRole('button', { name: 'Quitar la excepción de Limpieza' }))
    const dialog = screen.getByRole('dialog', { name: 'Quitar excepción' })
    expect(dialog).toHaveTextContent('va a usar la configuración general (7 / 15 / 30 días)')
    await user.click(within(dialog).getByRole('button', { name: 'Quitar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toMatchObject({ table: 'expiry_alert_settings', op: 'delete', filters: { id: 'cfg-cleaning' } })
  })

  it('el empleado no ve la sección en el menú ni puede entrar', async () => {
    setup('staff')
    expect(await screen.findByText('No tenés permiso para esta sección')).toBeInTheDocument()
    expect(screen.getByRole('navigation')).not.toHaveTextContent('Configuración')
  })
})

describe('Configuración: usuarios (dueño)', () => {
  it('lista usuarios; el propio no se edita', async () => {
    setup('admin')
    const table = await screen.findByRole('table', { name: 'Usuarios del sistema' })
    expect(await within(table).findByText('Empleado de prueba')).toBeInTheDocument()
    expect(within(table).getByText('Tu propio usuario no se edita acá')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /Editar Dueña de prueba/ })).not.toBeInTheDocument()
  })

  it('cambia el rol y desactiva a otro usuario', async () => {
    const { user, fake } = setup('admin')
    await user.click(await screen.findByRole('button', { name: 'Editar Empleado de prueba' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /^Encargado/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toEqual({
      table: 'profiles',
      op: 'update',
      payload: { full_name: 'Empleado de prueba', role: 'manager' },
      filters: { id: OTHER_USER },
    })

    await user.click(await screen.findByRole('button', { name: 'Desactivar a Empleado de prueba' }))
    const confirm = screen.getByRole('dialog', { name: 'Desactivar usuario' })
    await user.click(within(confirm).getByRole('button', { name: 'Desactivar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(2))
    expect(fake.writes[1]).toMatchObject({ table: 'profiles', payload: { is_active: false }, filters: { id: OTHER_USER } })
  })
})
