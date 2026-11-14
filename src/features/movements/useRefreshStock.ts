import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

/** Después de mover stock, vuelve a leer todo lo que muestra saldos o vencimientos. */
export function useRefreshStock() {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await Promise.all(
      ['movements', 'products', 'alerts', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )
  }, [queryClient])
}
