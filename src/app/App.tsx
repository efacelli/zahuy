import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { ToastProvider } from '../components/ui/ToastProvider'
import { supabaseConfig } from '../lib/supabase'
import { ConfigErrorScreen } from './ConfigErrorScreen'
import { createQueryClient } from './queryClient'
import { routes } from './routes'

export function App() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))

  if (!supabaseConfig.ok) return <ConfigErrorScreen problems={supabaseConfig.problems} />

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
