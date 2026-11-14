import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { ToastProvider } from '../components/ui/ToastProvider'
import { AuthProvider } from '../features/auth/AuthProvider'
import { requireSupabase, supabaseConfig } from '../lib/supabase'
import { ConfigErrorScreen } from './ConfigErrorScreen'
import { createQueryClient } from './queryClient'
import { routes } from './routes'

export function App() {
  if (!supabaseConfig.ok) return <ConfigErrorScreen problems={supabaseConfig.problems} />
  return <ConfiguredApp />
}

function ConfiguredApp() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  const [client] = useState(requireSupabase)

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider client={client}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
