/** Contrato §5.5: `vat_rate` admite 10,5% o 21%. */
export const VAT_RATES = [21, 10.5] as const
export type VatRate = (typeof VAT_RATES)[number]

export function formatVatRate(rate: number): string {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(rate)}%`
}
