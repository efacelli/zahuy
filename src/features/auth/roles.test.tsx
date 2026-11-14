import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { permissionsFor } from '../../domain/roles'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

describe('permissionsFor (contrato v0.4.0 §9)', () => {
  it('el empleado consulta, registra ingresos, consumo interno y cuenta cajas', () => {
    expect(permissionsFor('staff', true)).toEqual({
      manageInventory: false,
      receiveStock: true,
      registerInternalUse: true,
      registerAnyMovement: false,
      reverseMovements: false,
      updateBoxCount: true,
      viewDashboard: false,
      configureAlerts: false,
      manageUsers: false,
    })
  })

  it('el encargado gestiona todo menos usuarios', () => {
    const p = permissionsFor('manager', true)
    expect(p.manageInventory && p.registerAnyMovement && p.reverseMovements && p.viewDashboard).toBe(true)
    expect(p.manageUsers).toBe(false)
  })

  it('el dueño además gestiona usuarios', () => {
    expect(permissionsFor('admin', true).manageUsers).toBe(true)
  })

  it('inactivo o sin perfil: nada', () => {
    expect(Object.values(permissionsFor('admin', false)).some(Boolean)).toBe(false)
    expect(Object.values(permissionsFor(null, true)).some(Boolean)).toBe(false)
  })
})

describe('pantallas según el rol', () => {
  function renderAs(role: 'staff' | 'manager', path: string) {
    const fake = createFakeSupabase(fakeSession(), { role })
    fake.setTable('v_product_list', [])
    fake.setTable('categories', [{ id: '11111111-1111-4111-8111-111111111111', name: 'Lácteos', is_active: true }])
    fake.setTable('suppliers', [])
    return renderApp(path, fake.client)
  }

  it('el empleado entra directo a Productos y no ve Dashboard ni "Nuevo producto"', async () => {
    const router = renderAs('staff', '/')
    await screen.findByRole('heading', { level: 1, name: 'Productos' })
    expect(router.state.location.pathname).toBe('/productos')
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Nuevo producto/ })).not.toBeInTheDocument()
    expect(screen.getByText(/· Empleado/)).toBeInTheDocument()
  })

  it('el empleado no puede abrir el alta de producto aunque escriba la dirección', async () => {
    renderAs('staff', '/productos/nuevo')
    expect(await screen.findByText('No tenés permiso para esta sección')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar producto' })).not.toBeInTheDocument()
  })

  it('el empleado ve los catálogos en solo lectura', async () => {
    renderAs('staff', '/catalogos')
    expect(await screen.findByText('Lácteos')).toBeInTheDocument()
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nueva categoría/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar Lácteos' })).not.toBeInTheDocument()
  })

  it('el encargado ve Dashboard, "Nuevo producto" y puede editar catálogos', async () => {
    renderAs('manager', '/catalogos')
    expect(await screen.findByRole('button', { name: 'Editar Lácteos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('un usuario desactivado no puede operar', async () => {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager', isActive: false })
    renderApp('/productos', fake.client)
    expect(await screen.findByText('Tu usuario está desactivado')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('si no se puede leer el perfil, lo avisa y no muestra la app', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('profiles', null, { code: 'PGRST205', message: 'Could not find the table' })
    renderApp('/productos', fake.client)
    expect(await screen.findByText('No se pudo cargar tu perfil')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('si el usuario no tiene perfil, lo explica y deja salir', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('profiles', [])
    renderApp('/productos', fake.client)
    expect(await screen.findByText('Tu usuario no tiene perfil en el sistema')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
  })
})
