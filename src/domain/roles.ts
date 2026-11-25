/**
 * Roles y permisos (contrato v0.4.0, §4.1 y §9; `developer` desde v0.7.1, P-44).
 *
 * Esto solo decide qué se MUESTRA. La autorización real la hace la base con
 * RLS y en cada RPC: si la UI se equivoca, la base rechaza igual.
 */
export const APP_ROLES = ['developer', 'admin', 'manager', 'staff'] as const
export type AppRole = (typeof APP_ROLES)[number]

export const ROLE_LABEL: Record<AppRole, string> = {
  developer: 'Programador',
  admin: 'Dueño',
  manager: 'Encargado',
  staff: 'Empleado',
}

export interface Permissions {
  /** Alta y edición de productos (precios, stock mínimo, unidades por caja), catálogos. */
  manageInventory: boolean
  /** Registrar ingresos de mercadería (`receive_stock`). */
  receiveStock: boolean
  /** Consumo interno (`internal_use`). */
  registerInternalUse: boolean
  /** Ajustes, mermas, daños, devoluciones y salidas genéricas. */
  registerAnyMovement: boolean
  /** Revertir movimientos. */
  reverseMovements: boolean
  /** Actualizar el conteo de cajas de un producto. */
  updateBoxCount: boolean
  /** Dashboard del negocio (`v_inventory_summary`). */
  viewDashboard: boolean
  /** Configurar días de alerta por categoría. */
  configureAlerts: boolean
  /** Gestionar usuarios y leer la auditoría. */
  manageUsers: boolean
  /** Alta, edición, límite y bloqueo de clientes; autorizar ventas por encima del límite y anular pagos (§23). */
  manageCustomers: boolean
}

const NONE: Permissions = {
  manageInventory: false,
  receiveStock: false,
  registerInternalUse: false,
  registerAnyMovement: false,
  reverseMovements: false,
  updateBoxCount: false,
  viewDashboard: false,
  configureAlerts: false,
  manageUsers: false,
  manageCustomers: false,
}

export function permissionsFor(role: AppRole | null | undefined, isActive: boolean): Permissions {
  if (!role || !isActive) return NONE
  // El programador tiene los mismos permisos que el dueño (P-44).
  const owner = role === 'admin' || role === 'developer'
  const manager = role === 'manager' || owner
  return {
    manageInventory: manager,
    receiveStock: true,
    registerInternalUse: true,
    registerAnyMovement: manager,
    reverseMovements: manager,
    updateBoxCount: true,
    viewDashboard: manager,
    configureAlerts: manager,
    manageUsers: owner,
    manageCustomers: manager,
  }
}
