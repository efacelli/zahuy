import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '../../components/ui/States'
import type { Permissions } from '../../domain/roles'
import { usePermissions } from './useProfile'

interface RequirePermissionProps {
  permission: keyof Permissions
  children: ReactNode
}

/** Muestra el contenido solo si el rol lo permite (la base vuelve a controlar). */
export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const permissions = usePermissions()
  if (permissions[permission]) return <>{children}</>
  return (
    <EmptyState
      icon="error"
      title="No tenés permiso para esta sección"
      description="Esta acción la hace el encargado o el dueño."
      action={<Link to="/productos">Ir a Productos</Link>}
    />
  )
}
