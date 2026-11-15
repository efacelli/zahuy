import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { toAppError } from '../../lib/errors'
import { useAuth } from './auth-context'
import { FirstPasswordPage } from './FirstPasswordPage'
import { MUST_CHANGE_PASSWORD } from './password'
import { loginPath } from './redirect'
import { useProfile } from './useProfile'

/**
 * Protege las rutas internas y carga el perfil (rol y estado).
 * Es solo comodidad de navegación: la autorización real la hace la base
 * (RLS y RPC), no React (CLAUDE.md, Seguridad).
 */
export function RequireAuth() {
  const { status, signOut, user } = useAuth()
  const location = useLocation()
  const profile = useProfile()

  if (status === 'loading') return <LoadingState label="Verificando sesión…" />
  if (status === 'signedOut') {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />
  }

  if (profile.isPending) return <LoadingState label="Cargando tu perfil…" />
  if (profile.error) {
    // PGRST116 = no hay fila: el usuario existe en Auth pero no tiene perfil (o fue dado de baja).
    const missing = (profile.error as { code?: string }).code === 'PGRST116'
    return (
      <ErrorState
        title={missing ? 'Tu usuario no tiene perfil en el sistema' : 'No se pudo cargar tu perfil'}
        message={
          missing
            ? 'Hablá con el encargado o el dueño para que revise tu usuario.'
            : toAppError(profile.error).message
        }
        onRetry={missing ? undefined : () => void profile.refetch()}
        action={<Button onClick={() => void signOut()}>Salir</Button>}
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
  // Primer ingreso con la contraseña inicial: antes de entrar, elige la suya.
  if (user?.user_metadata?.[MUST_CHANGE_PASSWORD] === true) {
    return <FirstPasswordPage name={profile.data.full_name} onSignOut={() => void signOut()} />
  }
  return <Outlet />
}
