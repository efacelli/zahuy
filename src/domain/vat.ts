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
  const netCents = Math.round(netPrice * 100)
  const factorPerMille = Math.round(1000 + vatRate * 10)
  return Math.round((netCents * factorPerMille) / 1000) / 100
}
