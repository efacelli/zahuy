import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { toAppError } from '../../lib/errors'
import { useAuth } from './auth-context'
import { loginPath } from './redirect'
import { useProfile } from './useProfile'

/**
 * Protege las rutas internas y carga el perfil (rol y estado).
 * Es solo comodidad de navegación: la autorización real la hace la base
 * (RLS y RPC), no React (CLAUDE.md, Seguridad).
 */
export function RequireAuth() {
  const { status, signOut } = useAuth()
  const location = useLocation()
  const profile = useProfile()

  if (status === 'loading') return <LoadingState label="Verificando sesión…" />
  if (status === 'signedOut') {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />
  }

  if (profile.isPending) return <LoadingState label="Cargando tu perfil…" />
  if (profile.error) {
    return (
      <ErrorState
        message={`No se pudo cargar tu perfil. ${toAppError(profile.error).message}`}
        onRetry={() => void profile.refetch()}
      />
    )
  }
  if (!profile.data.is_active) {
    return (
      <EmptyState
        icon="error"
        title="Tu usuario está desactivado"
        description="No podés operar en el sistema. Si creés que es un error, hablá con el encargado o el dueño."
        action={<Button onClick={() => void signOut()}>Salir</Button>}
      />
    )
  }
  return <Outlet />
}
