import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { routes } from '../routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('AppLayout', () => {
  it('muestra las secciones de la Etapa 1 en el menú', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation')
    for (const label of ['Dashboard', 'Productos', 'Movimientos de stock', 'Alertas', 'Catálogos']) {
      expect(nav).toHaveTextContent(label)
    }
  })

  it('no muestra módulos futuros', () => {
    renderAt('/')
    for (const label of [/ventas/i, /caja/i, /clientes/i, /arca/i]) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
  })

  it('navega y marca la sección activa', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    await user.click(screen.getByRole('link', { name: 'Productos' }))
    expect(router.state.location.pathname).toBe('/productos')
    expect(screen.getByRole('heading', { level: 1, name: 'Productos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Productos' })).toHaveAttribute('aria-current', 'page')
  })

  it('abre y cierra el menú en pantallas chicas', async () => {
    const user = userEvent.setup()
    renderAt('/')
    const toggle = screen.getByRole('button', { name: 'Abrir menú' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('muestra una página para rutas inexistentes', () => {
    renderAt('/no-existe')
    expect(screen.getByText('No encontramos esta página')).toBeInTheDocument()
  })

  it('las secciones no muestran datos inventados', () => {
    renderAt('/productos')
    expect(screen.getByText('Sección en preparación')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
