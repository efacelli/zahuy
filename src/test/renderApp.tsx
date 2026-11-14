import type { SupabaseClient } from '@supabase/supabase-js'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../app/routes'
import { ToastProvider } from '../components/ui/ToastProvider'
import { AuthProvider } from '../features/auth/AuthProvider'

/** Renderiza la app completa (rutas reales) con un cliente de Supabase de prueba. */
export function renderApp(path: string, client: SupabaseClient) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ToastProvider>
      <AuthProvider client={client}>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>,
  )
  return router
}
