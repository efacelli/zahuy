import type { IconName } from '../components/ui/Icon'

export interface NavItem {
  path: string
  label: string
  icon: IconName
  description: string
}

/** Secciones de la Etapa 1. Ventas, caja, clientes y ARCA quedan fuera hasta su aprobación. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: 'dashboard', description: 'Resumen del inventario y alertas.' },
  { path: '/productos', label: 'Productos', icon: 'products', description: 'Catálogo, lotes y vencimientos.' },
  {
    path: '/movimientos',
    label: 'Movimientos de stock',
    icon: 'movements',
    description: 'Ingresos, salidas, ajustes, mermas, daños y devoluciones.',
  },
  { path: '/alertas', label: 'Alertas', icon: 'alerts', description: 'Lotes próximos a vencer y vencidos.' },
  { path: '/catalogos', label: 'Catálogos', icon: 'catalogs', description: 'Categorías, marcas y proveedores.' },
]
