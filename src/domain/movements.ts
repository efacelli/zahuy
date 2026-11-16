/** Contrato v0.4.0 §4.3: cada tipo tiene dirección fija; la cantidad siempre es positiva. */
export const MOVEMENT_TYPES = [
  'entry',
  'exit',
  'adjustment_in',
  'adjustment_out',
  'shrinkage',
  'damage',
  'customer_return',
  'supplier_return',
  'internal_use',
  // v0.6.3 (§15.2): solo lo escribe register_sale; se deshace con void_sale.
  'sale',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]
export type MovementDirection = 'in' | 'out'

interface MovementTypeInfo {
  label: string
  direction: MovementDirection
  reasonRequired: boolean
}

export const MOVEMENT_TYPE_INFO: Record<MovementType, MovementTypeInfo> = {
  entry: { label: 'Ingreso', direction: 'in', reasonRequired: false },
  exit: { label: 'Salida', direction: 'out', reasonRequired: false },
  adjustment_in: { label: 'Ajuste positivo', direction: 'in', reasonRequired: true },
  adjustment_out: { label: 'Ajuste negativo', direction: 'out', reasonRequired: true },
  shrinkage: { label: 'Merma', direction: 'out', reasonRequired: true },
  damage: { label: 'Producto dañado', direction: 'out', reasonRequired: true },
  customer_return: { label: 'Devolución de cliente', direction: 'in', reasonRequired: true },
  supplier_return: { label: 'Devolución a proveedor', direction: 'out', reasonRequired: true },
  internal_use: { label: 'Consumo interno', direction: 'out', reasonRequired: true },
  sale: { label: 'Venta', direction: 'out', reasonRequired: false },
}

/**
 * Tipos que se registran por producto con `register_product_movement` (§8.7):
 * todos salvo `entry`, que es un ingreso con lote nuevo (`receive_stock`).
 */
export const PRODUCT_MOVEMENT_TYPES = MOVEMENT_TYPES.filter((t) => t !== 'entry' && t !== 'sale')

/** Una venta no se anula desde el historial de stock: se anula la venta (§15.2). */
export function isReversible(type: MovementType): boolean {
  return type !== 'sale'
}

/** Tipos que el empleado puede registrar (§9). El encargado y el dueño, todos. */
export function movementTypesFor(canRegisterAny: boolean): MovementType[] {
  return canRegisterAny ? [...PRODUCT_MOVEMENT_TYPES] : ['internal_use']
}

export function signedQuantity(type: MovementType, quantity: number): number {
  return MOVEMENT_TYPE_INFO[type].direction === 'in' ? quantity : -quantity
}

/**
 * Contrato P-13: sobre un producto inactivo (discontinuado) solo se puede dar de
 * baja lo que quedó. Es el mismo conjunto que puede tocar lotes vencidos (P-15).
 */
export const INACTIVE_PRODUCT_MOVEMENT_TYPES: readonly MovementType[] = ['shrinkage', 'damage', 'supplier_return']

/** Tipos que se ofrecen para un producto, según el rol y si está activo. */
export function movementTypesForProduct(roleTypes: MovementType[], productIsActive: boolean): MovementType[] {
  return productIsActive ? roleTypes : roleTypes.filter((t) => INACTIVE_PRODUCT_MOVEMENT_TYPES.includes(t))
}
