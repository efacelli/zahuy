import type { IconName } from '../components/ui/Icon'
import type { Permissions } from '../domain/roles'

export interface NavItem {
  path: string
  label: string
  icon: IconName
  description: string
  /** Si se indica, la sección solo aparece en el menú para quien tenga ese permiso. */
  permission?: keyof Permissions
}

/** Secciones de la Etapa 1. Ventas, caja, clientes y ARCA quedan fuera hasta su aprobación. */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: 'dashboard',
    description: 'Resumen del inventario y alertas.',
    permission: 'viewDashboard',
  },
  { path: '/productos', label: 'Productos', icon: 'products', description: 'Catálogo, lotes y vencimientos.' },
  {
    path: '/movimientos',
    label: 'Movimientos de stock',
    icon: 'movements',
    description: 'Ingresos, salidas, ajustes, mermas, daños y devoluciones.',
  },
  { path: '/alertas', label: 'Alertas', icon: 'alerts', description: 'Lotes próximos a vencer y vencidos.' },
  { path: '/catalogos', label: 'Catálogos', icon: 'catalogs', description: 'Categorías, marcas y proveedores.' },
  {
    path: '/configuracion',
    label: 'Configuración',
    icon: 'settings',
    description: 'Días de alerta de vencimiento y usuarios.',
    permission: 'configureAlerts',
  },
  {
    path: '/auditoria',
    label: 'Auditoría',
    icon: 'clock',
    description: 'Quién cambió qué.',
    permission: 'manageUsers',
  },
]
