import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { EmptyState, ErrorState } from '../components/ui/States'

export function NotFoundPage() {
  return (
    <EmptyState
      title="No encontramos esta página"
      description="Puede que la dirección esté mal escrita o que la sección ya no exista."
      action={<Link to="/">Ir al dashboard</Link>}
    />
  )
}

export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  console.error(error)
  return (
    <ErrorState
      message="La pantalla tuvo un problema inesperado. Recargá la página; si se repite, avisá al administrador."
      onRetry={() => window.location.reload()}
    />
  )
}
