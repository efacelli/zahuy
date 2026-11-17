import { suggestedDiscount, type DiscountRule } from '../../domain/quantity-discount'
import { isIntegerUnit, type SaleUnit } from '../../domain/units'
import { parseDecimalInput } from '../../lib/numbers'

/**
 * Carrito de la caja. Solo para mostrar: el precio y los totales definitivos
 * los calcula la base en `register_sale` con el precio del momento (§15.1).
 * Se usan las mismas cuentas (§15.3.5) para que lo que ve el cajero coincida.
 * Las líneas con importe manual (balanza) y las libres siguen §20.
 */
export interface CartProduct {
  id: string
  sku: string
  name: string
  sale_unit: SaleUnit
  /** Precio final de góndola, con IVA (§5.5). */
  sale_price_with_vat: number
}

/** Producto del catálogo a precio de lista (con descuento por cantidad, §16). */
export interface ProductLine {
  kind: 'product'
  key: string
  product: CartProduct
  quantity: number
  /** Descuento elegido por el cajero, en %; null = el sugerido por la regla (§16.1). */
  discountPercent: number | null
}

/** Producto por kilo con el importe de la etiqueta de la balanza (§20, P-55 a P-57). */
export interface ManualLine {
  kind: 'manual'
  key: string
  product: CartProduct
  /** Peso en kg (del código de la etiqueta o escrito). */
  quantity: number
  /** Importe con IVA escrito por el cajero. */
  manualTotal: number
  /** Código de la etiqueta, si se escaneó (para avisar si se repite, P-58). */
  barcode: string | null
}

export type FreeVatRate = 21 | 10.5

/** Algo que no está cargado como producto: no descuenta stock (§20.8). */
export interface FreeLine {
  kind: 'free'
  key: string
  description: string
  vatRate: FreeVatRate
  quantity: number
  manualTotal: number
}

export type CartLine = ProductLine | ManualLine | FreeLine

export type CartAction =
  | { type: 'add'; product: CartProduct; quantity?: number }
  | { type: 'addManual'; product: CartProduct; quantity: number; total: number; barcode: string | null }
  | { type: 'addFree'; description: string; vatRate: FreeVatRate; quantity: number; total: number }
  | { type: 'set'; key: string; quantity: number }
  | { type: 'discount'; key: string; percent: number | null }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

let lineSeq = 0
const nextKey = (prefix: string) => `${prefix}-${++lineSeq}`

/** Nombre que se muestra y se imprime. */
export function lineName(line: CartLine): string {
  return line.kind === 'free' ? line.description : line.product.name
}

/**
 * Un producto no puede estar a la vez a precio de lista y con importe manual: la
 * base lo rechaza (`INVALID_MANUAL_PRICE`, §20.2). Devuelve el aviso, o null.
 */
export function mixError(lines: CartLine[], productId: string, kind: 'product' | 'manual'): string | null {
  for (const l of lines) {
    if (l.kind === 'free' || l.kind === kind || l.product.id !== productId) continue
    return kind === 'manual'
      ? `${l.product.name} ya está en el carrito con el precio de Zahuy. Quitalo para cobrarlo con el importe de la etiqueta.`
      : `${l.product.name} ya está en el carrito con importe de etiqueta. Cobralo igual (con la etiqueta o el botón de balanza) o quitá esa línea.`
  }
  return null
}

/**
 * Productos de lista: un ítem por producto (como `sale_items`), escanear dos veces
 * suma. Las líneas manuales y libres quedan cada una aparte. Lo último agregado queda arriba.
 */
export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case 'add': {
      const quantity = action.quantity ?? 1
      const existing = lines.find((l): l is ProductLine => l.kind === 'product' && l.product.id === action.product.id)
      if (!existing) {
        return [{ kind: 'product', key: `p-${action.product.id}`, product: action.product, quantity, discountPercent: null }, ...lines]
      }
      return [
        { ...existing, product: action.product, quantity: roundQuantity(existing.quantity + quantity) },
        ...lines.filter((l) => l !== existing),
      ]
    }
    case 'addManual':
      return [
        {
          kind: 'manual',
          key: nextKey('m'),
          product: action.product,
          quantity: roundQuantity(action.quantity),
          manualTotal: roundMoney(action.total),
          barcode: action.barcode,
        },
        ...lines,
      ]
    case 'addFree':
      return [
        {
          kind: 'free',
          key: nextKey('f'),
          description: action.description.trim(),
          vatRate: action.vatRate,
          quantity: action.quantity,
          manualTotal: roundMoney(action.total),
        },
        ...lines,
      ]
    case 'set':
      return action.quantity > 0
        ? lines.map((l) => (l.key === action.key && l.kind === 'product' ? { ...l, quantity: roundQuantity(action.quantity) } : l))
        : lines.filter((l) => l.key !== action.key)
    case 'discount':
      return lines.map((l) => (l.key === action.key && l.kind === 'product' ? { ...l, discountPercent: action.percent } : l))
    case 'remove':
      return lines.filter((l) => l.key !== action.key)
    case 'clear':
      return []
  }
}

const roundQuantity = (q: number) => Math.round(q * 1000) / 1000
const roundMoney = (n: number) => Math.round(n * 100) / 100

/** Importes de una línea, con las mismas cuentas que `register_sale` (§15.3.5, §16.2 y §20). */
export interface LinePricing {
  /** Lo que sugiere la regla para esta cantidad (0 en manuales y libres). */
  suggestedPercent: number
  /** Lo que se aplica (el elegido o, si no hay, el sugerido). */
  appliedPercent: number
  /** `list_line_total`: `round(quantity * unit_price_with_vat, 2)` o el importe manual. */
  listTotal: number
  /** `discount_amount`: `round(list_line_total * discount_percent / 100, 2)`. */
  discountAmount: number
  /** `line_total`: lo que se cobra por la línea. */
  total: number
}

export type PricedLine = CartLine & LinePricing

export function priceLine(line: CartLine, rule: DiscountRule): PricedLine {
  if (line.kind !== 'product') {
    return { ...line, suggestedPercent: 0, appliedPercent: 0, listTotal: line.manualTotal, discountAmount: 0, total: line.manualTotal }
  }
  const suggestedPercent = suggestedDiscount(line.quantity, line.product.sale_unit, rule)
  const appliedPercent = line.discountPercent ?? suggestedPercent
  const listTotal = roundMoney(line.quantity * line.product.sale_price_with_vat)
  const discountAmount = roundMoney((listTotal * appliedPercent) / 100)
  return { ...line, suggestedPercent, appliedPercent, listTotal, discountAmount, total: roundMoney(listTotal - discountAmount) }
}

export interface PricedCart {
  lines: PricedLine[]
  /** `sales.total_amount` = Σ `line_total` (antes del redondeo). */
  total: number
  /** `sales.discount_total` = Σ `discount_amount`. */
  discountTotal: number
}

export function priceCart(lines: CartLine[], rule: DiscountRule): PricedCart {
  const priced = lines.map((l) => priceLine(l, rule))
  return {
    lines: priced,
    total: roundMoney(priced.reduce((sum, l) => sum + l.total, 0)),
    discountTotal: roundMoney(priced.reduce((sum, l) => sum + l.discountAmount, 0)),
  }
}

/** Ítem de `register_sale` (§15.6, §16.3 y §20.2). */
export type SaleItemParam =
  | { product_id: string; quantity: number; discount_percent: number }
  | { product_id: string; quantity: number; discount_percent: 0; manual_line_total: number }
  | {
      product_id: null
      description: string
      vat_rate: FreeVatRate
      quantity: number
      discount_percent: 0
      manual_line_total: number
    }

export function toSaleItem(line: CartLine & Partial<LinePricing>): SaleItemParam {
  switch (line.kind) {
    case 'product':
      return { product_id: line.product.id, quantity: line.quantity, discount_percent: line.appliedPercent ?? 0 }
    case 'manual':
      return { product_id: line.product.id, quantity: line.quantity, discount_percent: 0, manual_line_total: line.manualTotal }
    case 'free':
      return {
        product_id: null,
        description: line.description,
        vat_rate: line.vatRate,
        quantity: line.quantity,
        discount_percent: 0,
        manual_line_total: line.manualTotal,
      }
  }
}

/** ¿El carrito necesita las funciones de §20 en la base? */
export function needsManualSupport(lines: CartLine[]): boolean {
  return lines.some((l) => l.kind !== 'product')
}

/** Importe con el precio de Zahuy, para comparar con el de la etiqueta. */
export function catalogTotal(product: CartProduct, quantity: number): number {
  return roundMoney(quantity * product.sale_price_with_vat)
}

/** P-56: la caja avisa (no bloquea) si el importe difiere más de 20 % del de Zahuy. */
export const MANUAL_DIFF_WARNING = 0.2

export function manualDifference(manual: number, catalog: number): { ratio: number; warn: boolean } {
  if (catalog <= 0) return { ratio: 0, warn: false }
  const ratio = (manual - catalog) / catalog
  return { ratio, warn: Math.abs(ratio) > MANUAL_DIFF_WARNING }
}

/** Importe escrito por el cajero: mayor que 0 y con hasta 2 decimales. */
export function parseAmount(raw: string): { value: number | null; error: string | null } {
  const n = parseDecimalInput(raw.trim())
  if (raw.trim() === '') return { value: null, error: 'Escribí el importe.' }
  if (n === null) return { value: null, error: 'Escribí un número, por ejemplo 2327,50.' }
  if (n <= 0) return { value: null, error: 'El importe tiene que ser mayor que cero.' }
  if (Math.round(n * 100) / 100 !== n) return { value: null, error: 'Como máximo 2 decimales.' }
  return { value: n, error: null }
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
