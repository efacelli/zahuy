import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { formatCuit, isValidCuit, normalizeCuit } from '../../lib/cuit'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { CATALOGS, catalogFormSchema } from './catalog-config'

const LACTEOS = { id: '11111111-1111-4111-8111-111111111111', name: 'Lácteos', is_active: true }
const BEBIDAS = { id: '11111111-1111-4111-8111-111111111112', name: 'Bebidas', is_active: true }
const VIEJA = { id: '11111111-1111-4111-8111-111111111113', name: 'Golosinas viejas', is_active: false }

function setup(path = '/catalogos') {
  const fake = createFakeSupabase(fakeSession())
  fake.setTable('categories', [LACTEOS, BEBIDAS, VIEJA].map((r) => ({ ...r })))
  fake.setTable('brands', [])
  fake.setTable('suppliers', [
    { id: '33333333-3333-4333-8333-333333333331', name: 'Distribuidora Norte', is_active: true, tax_id: '33693450239', phone: '351 555-0000', email: null, notes: null },
  ])
  const router = renderApp(path, fake.client)
  return { fake, router, user: userEvent.setup() }
}

describe('CUIT', () => {
  it('valida el dígito verificador', () => {
    expect(isValidCuit('33-69345023-9')).toBe(true)
    expect(isValidCuit('33693450239')).toBe(true)
    expect(isValidCuit('33-69345023-8')).toBe(false)
    expect(isValidCuit('123')).toBe(false)
  })

  it('normaliza y formatea', () => {
    expect(normalizeCuit(' 33-69345023-9 ')).toBe('33693450239')
    expect(formatCuit('33693450239')).toBe('33-69345023-9')
    expect(formatCuit(null)).toBe('—')
  })
})

describe('catalogFormSchema', () => {
  it('categorías y marcas solo envían el nombre', () => {
    expect(catalogFormSchema(CATALOGS.categories).parse({ name: ' Lácteos ', tax_id: '', phone: '', email: '', notes: '' })).toEqual({
      name: 'Lácteos',
    })
  })

  it('proveedores: CUIT sin guiones, email en minúsculas, vacíos como null', () => {
    expect(
      catalogFormSchema(CATALOGS.suppliers).parse({
        name: 'Distribuidora',
        tax_id: '33-69345023-9',
        phone: '',
        email: 'Ventas@Distri.com ',
        notes: '',
      }),
    ).toEqual({ name: 'Distribuidora', tax_id: '33693450239', phone: null, email: 'ventas@distri.com', notes: null })
  })

  it('rechaza nombre vacío o largo, CUIT y email inválidos', () => {
    const r = catalogFormSchema(CATALOGS.suppliers).safeParse({ name: '', tax_id: '20-1', phone: '', email: 'x@', notes: '' })
    expect(r.success).toBe(false)
    const long = catalogFormSchema(CATALOGS.categories).safeParse({ name: 'x'.repeat(81), tax_id: '', phone: '', email: '', notes: '' })
    expect(long.success).toBe(false)
  })
})

describe('Catálogos', () => {
  it('lista solo activos por defecto y puede mostrar inactivos', async () => {
    const { user } = setup()
    expect(await screen.findByText('Lácteos')).toBeInTheDocument()
    expect(screen.queryByText('Golosinas viejas')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Mostrar inactivos'))
    expect(screen.getByText('Golosinas viejas')).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('busca sin importar tildes ni mayúsculas', async () => {
    const { user } = setup()
    await screen.findByText('Lácteos')
    await user.type(screen.getByRole('searchbox'), 'lacteo')
    expect(screen.getByText('Lácteos')).toBeInTheDocument()
    expect(screen.queryByText('Bebidas')).not.toBeInTheDocument()
  })

  it('cambia de pestaña y la guarda en la URL', async () => {
    const { user, router } = setup()
    await user.click(await screen.findByRole('tab', { name: 'Proveedores' }))
    expect(router.state.location.search).toBe('?tipo=proveedores')
    expect(await screen.findByText('Distribuidora Norte')).toBeInTheDocument()
    expect(screen.getByText('33-69345023-9')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Proveedores' })).toHaveAttribute('aria-selected', 'true')
  })

  it('las pestañas se recorren con las flechas del teclado', async () => {
    const { user, router } = setup()
    const tab = await screen.findByRole('tab', { name: 'Categorías' })
    tab.focus()
    await user.keyboard('{ArrowRight}')
    expect(router.state.location.search).toBe('?tipo=marcas')
    expect(screen.getByRole('tab', { name: 'Marcas' })).toHaveFocus()
  })

  it('crea una categoría', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: '+ Nueva categoría' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva categoría' })
    // El foco arranca en el primer campo: se puede escribir directo.
    expect(within(dialog).getByLabelText(/^Nombre/)).toHaveFocus()
    await user.keyboard('  Fiambres ')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.writes).toEqual([{ table: 'categories', op: 'insert', payload: { name: 'Fiambres' }, filters: {} }])
    expect(await screen.findByText('Fiambres')).toBeInTheDocument()
    expect(screen.getByText('Se creó "Fiambres".')).toBeInTheDocument()
  })

  it('muestra el nombre duplicado sin cerrar el formulario', async () => {
    const { user, fake } = setup()
    fake.failNextWrite('categories', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "categories_name_key"',
    })
    await user.click(await screen.findByRole('button', { name: '+ Nueva categoría' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'lácteos')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ya existe una categoría con ese nombre.')
  })

  it('edita un proveedor', async () => {
    const { user, fake } = setup('/catalogos?tipo=proveedores')
    await user.click(await screen.findByRole('button', { name: 'Editar Distribuidora Norte' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar proveedor' })
    expect(within(dialog).getByLabelText(/^CUIT/)).toHaveValue('33693450239')
    await user.type(within(dialog).getByLabelText(/^Email/), 'pedidos@norte.test')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toMatchObject({
      table: 'suppliers',
      op: 'update',
      payload: { email: 'pedidos@norte.test', tax_id: '33693450239' },
      filters: { id: '33333333-3333-4333-8333-333333333331' },
    })
  })

  it('desactivar pide confirmación y no borra', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: 'Desactivar Bebidas' }))
    const dialog = screen.getByRole('dialog', { name: 'Desactivar categoría' })
    expect(fake.writes).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }))
    await waitFor(() => expect(fake.writes).toHaveLength(1))
    expect(fake.writes[0]).toMatchObject({ op: 'update', payload: { is_active: false } })
    await waitFor(() => expect(screen.queryByText('Bebidas')).not.toBeInTheDocument())
  })

  it('si la tabla todavía no existe, lo avisa', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setTable('categories', null, { code: 'PGRST205', message: 'Could not find the table' })
    renderApp('/catalogos', fake.client)
    expect(await screen.findByText(/todavía no está disponible en el servidor/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
