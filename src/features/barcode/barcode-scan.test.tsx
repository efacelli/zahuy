import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const CODE = '4006381333931'
const PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sku: '000001',
  name: 'Yogur frutilla',
  barcode: CODE,
  sale_unit: 'unit',
  units_per_box: 12,
  is_active: true,
}

/** Simula el lector USB: números seguidos (sin pausa) y Enter, fuera de cualquier campo. */
function scan(code: string) {
  for (const key of [...code, 'Enter']) fireEvent.keyDown(document.body, { key })
}

function setup(role: 'manager' | 'staff', path = '/alertas') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('products', [{ ...PRODUCT }])
  const router = renderApp(path, fake.client)
  return { fake, router }
}

describe('lector de códigos de barras', () => {
  it('escanear desde cualquier pantalla abre la ficha del producto', async () => {
    const { router } = setup('staff')
    await screen.findByRole('heading', { level: 1, name: 'Alertas' })
    scan(CODE)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/productos/${PRODUCT.id}`))
  })

  it('un código que no existe lleva al encargado al alta con el código cargado', async () => {
    const { router } = setup('manager')
    await screen.findByRole('heading', { level: 1, name: 'Alertas' })
    scan('96385074')
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos/nuevo'))
    expect(router.state.location.search).toBe('?codigo=96385074')
    expect(await screen.findByLabelText(/^Código de barras/)).toHaveValue('96385074')
    expect(screen.getByText(/No hay ningún producto con el código 96385074/)).toBeInTheDocument()
  })

  it('al empleado le avisa que el código no existe, sin llevarlo al alta', async () => {
    const { router } = setup('staff')
    await screen.findByRole('heading', { level: 1, name: 'Alertas' })
    scan('96385074')
    expect(await screen.findByText(/Avisale al encargado/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/alertas')
  })

  it('no actúa mientras se escribe en un campo', async () => {
    const { router } = setup('staff')
    await screen.findByRole('heading', { level: 1, name: 'Alertas' })
    const search = screen.getByRole('searchbox')
    for (const key of [...CODE, 'Enter']) fireEvent.keyDown(search, { key })
    await new Promise((r) => setTimeout(r, 50))
    expect(router.state.location.pathname).toBe('/alertas')
  })

  it('en el ingreso de mercadería, escanear elige el producto y pasa a la cantidad', async () => {
    setup('staff', '/movimientos')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '+ Ingreso de mercadería' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox'), `${CODE}{Enter}`)
    expect(await within(dialog).findByText('Yogur frutilla')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByLabelText(/^Cantidad/)).toHaveFocus())
  })

  it('en el buscador, un código desconocido lo dice', async () => {
    setup('staff', '/movimientos')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '+ Ingreso de mercadería' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox'), '96385074{Enter}')
    expect(await within(dialog).findByText('No hay ningún producto activo con el código 96385074.')).toBeInTheDocument()
  })
})
