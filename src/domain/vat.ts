/** Contrato §5.5: `vat_rate` admite 10,5% o 21%. */
export const VAT_RATES = [21, 10.5] as const
export type VatRate = (typeof VAT_RATES)[number]

export function formatVatRate(rate: number): string {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(rate)}%`
}

/**
 * Vista previa del precio final con IVA mientras se completa el formulario.
 * El valor oficial es `products.sale_price_with_vat`, calculado por la base
 * (contrato v0.4.0 §5.5): `round(sale_price * (1 + vat_rate / 100), 2)`.
 * Se calcula en centavos enteros para no arrastrar errores de punto flotante.
 */
export function priceWithVatPreview(netPrice: number, vatRate: number): number {
  // Desde v0.5.0 (P-24) el precio sin IVA tiene 4 decimales: se calcula en diezmilésimos.
  const net = Math.round(netPrice * 10_000)
  const factorPerMille = Math.round(1000 + vatRate * 10)
  return Math.round((net * factorPerMille) / 100_000) / 100
}

/** Precio sin IVA (4 decimales) que da exactamente ese precio final (contrato §5.5, P-24). */
export function salePriceFromFinal(finalPrice: number, vatRate: number): number {
  return Math.round((finalPrice / (1 + vatRate / 100)) * 10_000) / 10_000
}

/** Precio sin IVA a partir del costo sin IVA y la ganancia en % (como el sistema anterior). */
export function salePriceFromMargin(cost: number, marginPercent: number): number {
  return Math.round(cost * (1 + marginPercent / 100) * 10_000) / 10_000
}

/** Ganancia en % sobre el costo (ambos sin IVA), con 2 decimales. Null si no se puede calcular. */
export function marginPercent(cost: number | null, salePrice: number | null): number | null {
  if (cost === null || salePrice === null || cost <= 0) return null
  return Math.round((salePrice / cost - 1) * 10_000) / 100
}

/** Número para un campo de texto con coma decimal (sin ceros de más). */
export function toDecimalInput(n: number, maxDecimals: number): string {
  return String(Number(n.toFixed(maxDecimals))).replace('.', ',')
}
