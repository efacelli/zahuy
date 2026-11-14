import { Navigate } from 'react-router'
import { usePermissions } from '../features/auth/useProfile'
import { DashboardPage } from '../features/dashboard/DashboardPage'

/** Inicio: el dashboard para encargado y dueño; el empleado va directo a Productos. */
export function HomePage() {
  const { viewDashboard } = usePermissions()
  return viewDashboard ? <DashboardPage /> : <Navigate to="/productos" replace />
}
