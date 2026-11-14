import { Navigate, Outlet, useLocation } from 'react-router'
import { LoadingState } from '../../components/ui/States'
import { useAuth } from './auth-context'
import { loginPath } from './redirect'

/**
 * Protege las rutas internas. Es solo comodidad de navegación:
 * la autorización real la hace la RLS en la base (CLAUDE.md, Seguridad).
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <LoadingState label="Verificando sesión…" />
  if (status === 'signedOut') {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />
  }
  return <Outlet />
}
