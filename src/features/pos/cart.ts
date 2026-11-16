import { isIntegerUnit, type SaleUnit } from '../../domain/units'
import { parseDecimalInput } from '../../lib/numbers'

/**
 * Carrito de la caja. Solo para mostrar: el precio y los totales definitivos
 * los calcula la base en `register_sale` con el precio del momento (§15.1).
 * Se usan las mismas cuentas (§15.3.5) para que lo que ve el cajero coincida.
 */
export interface CartProduct {
  id: string
  sku: string
  name: string
  sale_unit: SaleUnit
  /** Precio final de góndola, con IVA (§5.5). */
  sale_price_with_vat: number
}

export interface CartLine {
  product: CartProduct
  quantity: number
}

export type CartAction =
  | { type: 'add'; product: CartProduct; quantity?: number }
  | { type: 'set'; productId: string; quantity: number }
  | { type: 'remove'; productId: string }
  | { type: 'clear' }

/** Un ítem por producto (como `sale_items`): escanear dos veces suma; el último agregado queda arriba. */
export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case 'add': {
      const quantity = action.quantity ?? 1
      const existing = lines.find((l) => l.product.id === action.product.id)
      if (!existing) return [{ product: action.product, quantity }, ...lines]
      return [
        { product: action.product, quantity: roundQuantity(existing.quantity + quantity) },
        ...lines.filter((l) => l !== existing),
      ]
    }
    case 'set':
      return action.quantity > 0
        ? lines.map((l) => (l.product.id === action.productId ? { ...l, quantity: roundQuantity(action.quantity) } : l))
        : lines.filter((l) => l.product.id !== action.productId)
    case 'remove':
      return lines.filter((l) => l.product.id !== action.productId)
    case 'clear':
      return []
  }
}

const roundQuantity = (q: number) => Math.round(q * 1000) / 1000
const roundMoney = (n: number) => Math.round(n * 100) / 100

/** `round(quantity * unit_price_with_vat, 2)` (§15.3.5). */
export function lineTotal(line: CartLine): number {
  return roundMoney(line.quantity * line.product.sale_price_with_vat)
}

export function cartTotal(lines: CartLine[]): number {
  return roundMoney(lines.reduce((sum, l) => sum + lineTotal(l), 0))
}


/** Cantidad válida para la unidad del producto (enteros salvo kg, g, l…). */
export function quantityError(quantity: number, unit: SaleUnit): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return 'La cantidad tiene que ser mayor que cero.'
  if (isIntegerUnit(unit) && !Number.isInteger(quantity)) return 'Este producto se vende por unidad entera.'
  return null
}

/**
 * "3*" antes del código o del nombre multiplica: `3*7790001` suma 3 unidades,
 * `1,5*` 1,5 kg. Como en las cajas de toda la vida.
 */
export function parseScanInput(raw: string): { quantity: number | null; text: string } {
  const match = /^\s*(\d+(?:[.,]\d{1,3})?)\s*\*\s*(.*)$/.exec(raw)
  if (!match) return { quantity: null, text: raw.trim() }
  return { quantity: parseDecimalInput(match[1]!), text: match[2]!.trim() }
}
