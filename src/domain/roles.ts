/**
 * Roles y permisos (contrato v0.4.0, §4.1 y §9).
 *
 * Esto solo decide qué se MUESTRA. La autorización real la hace la base con
 * RLS y en cada RPC: si la UI se equivoca, la base rechaza igual.
 */
export const APP_ROLES = ['admin', 'manager', 'staff'] as const
export type AppRole = (typeof APP_ROLES)[number]

export const ROLE_LABEL: Record<AppRole, string> = {
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
}

export function permissionsFor(role: AppRole | null | undefined, isActive: boolean): Permissions {
  if (!role || !isActive) return NONE
  const manager = role === 'manager' || role === 'admin'
  return {
    manageInventory: manager,
    receiveStock: true,
    registerInternalUse: true,
    registerAnyMovement: manager,
    reverseMovements: manager,
    updateBoxCount: true,
    viewDashboard: manager,
    configureAlerts: manager,
    manageUsers: role === 'admin',
  }
}
