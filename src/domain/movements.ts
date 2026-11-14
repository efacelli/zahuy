/** Contrato §4.3: cada tipo tiene dirección fija; la cantidad siempre es positiva. */
export const MOVEMENT_TYPES = [
  'entry',
  'exit',
  'adjustment_in',
  'adjustment_out',
  'shrinkage',
  'damage',
  'customer_return',
  'supplier_return',
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
}

export function signedQuantity(type: MovementType, quantity: number): number {
  return MOVEMENT_TYPE_INFO[type].direction === 'in' ? quantity : -quantity
}
