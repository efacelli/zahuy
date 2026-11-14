import { useQuery } from '@tanstack/react-query'
import { permissionsFor, type AppRole, type Permissions } from '../../domain/roles'
import { useSupabase } from '../../lib/supabase-context'
import { useAuth } from './auth-context'

/** Perfil del usuario (contrato §5.1). */
export interface Profile {
  id: string
  full_name: string
  role: AppRole
  is_active: boolean
}

export function profileQueryKey(userId: string | undefined) {
  return ['profile', userId] as const
}

/** Perfil de quien inició sesión. Un usuario inactivo puede leer el suyo (contrato §5.1). */
export function useProfile() {
  const client = useSupabase()
  const { user } = useAuth()
  const userId = user?.id
  return useQuery({
    queryKey: profileQueryKey(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, role, is_active')
        .eq('id', userId as string)
        .single()
      if (error) throw error
      return data as Profile
    },
  })
}

/** Permisos para decidir qué mostrar. Mientras carga o si falla, no permite nada. */
export function usePermissions(): Permissions & { role: AppRole | null } {
  const { data } = useProfile()
  return { ...permissionsFor(data?.role, data?.is_active ?? false), role: data?.role ?? null }
}
