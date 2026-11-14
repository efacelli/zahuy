import { useQuery } from '@tanstack/react-query'
import { useSupabase } from '../../lib/supabase-context'
import { fetchCatalogOptions, type CatalogTable } from './api'

export function catalogQueryKey(table: CatalogTable) {
  return ['catalog-options', table] as const
}

export function useCatalogOptions(table: CatalogTable) {
  const client = useSupabase()
  return useQuery({
    queryKey: catalogQueryKey(table),
    queryFn: () => fetchCatalogOptions(client, table),
    staleTime: 5 * 60_000,
  })
}
