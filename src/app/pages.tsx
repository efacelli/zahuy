import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { EmptyState, ErrorState } from '../components/ui/States'
import { NAV_ITEMS, type NavItem } from './navigation'
import { SectionPage } from './SectionPage'

function navItem(path: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.path === path)
  if (!item) throw new Error(`Sección no definida: ${path}`)
  return item
}

export function DashboardPage() {
  return (
    <SectionPage
      item={navItem('/')}
      upcoming={[
        'Cantidad de productos activos y con stock bajo.',
        'Lotes próximos a vencer, con vencimiento urgente y vencidos.',
        'Últimos movimientos de stock.',
      ]}
    />
  )
}

export function MovementsPage() {
  return (
    <SectionPage
      item={navItem('/movimientos')}
      upcoming={[
        'Ingresos, salidas, ajustes, mermas, daños y devoluciones, con confirmación.',
        'Historial con producto, lote, cantidad, fecha, usuario y motivo.',
      ]}
    />
  )
}

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
