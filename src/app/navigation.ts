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

/** Secciones. La caja (etapa 5), ARCA y los clientes con cuenta corriente (§23) se adelantaron a pedido de `efacelli`. */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: 'dashboard',
    description: 'Resumen del inventario y alertas.',
    permission: 'viewDashboard',
  },
  { path: '/caja', label: 'Caja', icon: 'cart', description: 'Vender con el lector y cobrar.' },
  { path: '/ventas', label: 'Ventas', icon: 'receipt', description: 'Historial de ventas, tickets y anulaciones.' },
  { path: '/clientes', label: 'Clientes', icon: 'clipboard', description: 'Cuentas corrientes: deudas, límites y pagos.' },
  {
    path: '/turnos',
    label: 'Turnos de caja',
    icon: 'clock',
    description: 'Aperturas, cierres y arqueos de cada caja.',
    permission: 'viewDashboard',
  },
  { path: '/productos', label: 'Productos', icon: 'products', description: 'Catálogo, lotes y vencimientos.' },
  {
    path: '/movimientos',
    label: 'Movimientos de stock',
    icon: 'movements',
    description: 'Ingresos, salidas, ajustes, mermas, daños y devoluciones.',
  },
  {
    path: '/inventario',
    label: 'Carga de inventario',
    icon: 'inbox',
    description: 'Cargar el stock recorriendo las góndolas con el lector.',
  },
  { path: '/alertas', label: 'Alertas', icon: 'alerts', description: 'Lotes próximos a vencer y vencidos.' },
  {
    path: '/reposicion',
    label: 'Reposición',
    icon: 'clipboard',
    description: 'Qué pedir a cada proveedor para volver al stock mínimo.',
  },
  {
    path: '/precios',
    label: 'Aumentos de precio',
    icon: 'trendUp',
    description: 'Subir o bajar precios de muchos productos a la vez.',
    permission: 'manageInventory',
  },
  {
    path: '/etiquetas',
    label: 'Etiquetas de góndola',
    icon: 'tag',
    description: 'Imprimir los precios para las góndolas.',
  },
  { path: '/catalogos', label: 'Catálogos', icon: 'catalogs', description: 'Categorías, marcas y proveedores.' },
  {
    path: '/configuracion',
    label: 'Configuración',
    icon: 'settings',
    description: 'Alertas de vencimiento, ventas y ticket, y usuarios.',
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
