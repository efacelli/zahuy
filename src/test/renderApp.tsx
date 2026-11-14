import type { SupabaseClient } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../app/routes'
import { ToastProvider } from '../components/ui/ToastProvider'
import { AuthProvider } from '../features/auth/AuthProvider'
import { SupabaseContext } from '../lib/supabase-context'

/** Renderiza la app completa (rutas reales) con un cliente de Supabase de prueba. */
export function renderApp(path: string, client: SupabaseClient) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <SupabaseContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider client={client}>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </SupabaseContext.Provider>,
  )
  return router
}
