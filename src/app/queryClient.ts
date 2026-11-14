import { QueryClient } from '@tanstack/react-query'
import { toAppError } from '../lib/errors'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Reintenta solo errores de red; un error de permisos o de datos no se arregla reintentando.
        retry: (failureCount, error) => failureCount < 2 && toAppError(error).kind === 'network',
      },
      mutations: {
        // Las escrituras de stock son idempotentes, pero el reintento lo decide el formulario
        // (con la misma clave), no un reintento automático silencioso.
        retry: false,
      },
    },
  })
}
