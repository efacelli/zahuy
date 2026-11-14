/**
 * Contrato v0.4.0 §4.4. El valor lo calcula la base (v_batch_status) con los días
 * configurados por categoría; acá solo se presenta.
 */
export const EXPIRY_STATUSES = [
  'depleted',
  'no_expiry',
  'expired',
  'expires_urgent',
  'expires_soon',
  'expires_upcoming',
  'ok',
] as const

export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number]

export const EXPIRY_STATUS_LABEL: Record<ExpiryStatus, string> = {
  depleted: 'Agotado',
  no_expiry: 'Sin vencimiento',
  expired: 'Vencido',
  expires_urgent: 'Vencimiento urgente',
  expires_soon: 'Vence pronto',
  expires_upcoming: 'Próximo a vencer',
  ok: 'Vigente',
}

export const ALERT_LEVELS = ['warning', 'urgent', 'expired'] as const
export type AlertLevel = (typeof ALERT_LEVELS)[number]

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  warning: 'Próximo a vencer',
  urgent: 'Vencimiento urgente',
  expired: 'Vencido',
}

/** Contador de días: "vence hoy", "vence mañana", "vence en 5 días", "venció hace 2 días". */
export function daysLabel(days: number): string {
  if (days === 0) return 'vence hoy'
  if (days === 1) return 'vence mañana'
  if (days > 1) return `vence en ${days} días`
  if (days === -1) return 'venció ayer'
  return `venció hace ${-days} días`
}

/** Niveles de alerta en la UI (contrato §4.4). `null` = no alerta. */
export function alertLevelFor(status: ExpiryStatus): AlertLevel | null {
  switch (status) {
    case 'expires_upcoming':
    case 'expires_soon':
      return 'warning'
    case 'expires_urgent':
      return 'urgent'
    case 'expired':
      return 'expired'
    case 'ok':
    case 'no_expiry':
    case 'depleted':
      return null
  }
}
