/** Contrato §4.4. El valor lo calcula la base (v_batch_status); acá solo se presenta. */
export const EXPIRY_STATUSES = [
  'depleted',
  'no_expiry',
  'expired',
  'expires_7',
  'expires_15',
  'expires_30',
  'ok',
] as const

export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number]

export const EXPIRY_STATUS_LABEL: Record<ExpiryStatus, string> = {
  depleted: 'Agotado',
  no_expiry: 'Sin vencimiento',
  expired: 'Vencido',
  expires_7: 'Vence en 7 días o menos',
  expires_15: 'Vence en 15 días o menos',
  expires_30: 'Vence en 30 días o menos',
  ok: 'Vigente',
}

export const ALERT_LEVELS = ['warning', 'urgent', 'expired'] as const
export type AlertLevel = (typeof ALERT_LEVELS)[number]

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  warning: 'Próximo a vencer',
  urgent: 'Vencimiento urgente',
  expired: 'Vencido',
}

/** Niveles de alerta en la UI (contrato §4.4). `null` = no alerta. */
export function alertLevelFor(status: ExpiryStatus): AlertLevel | null {
  switch (status) {
    case 'expires_30':
    case 'expires_15':
      return 'warning'
    case 'expires_7':
      return 'urgent'
    case 'expired':
      return 'expired'
    case 'ok':
    case 'no_expiry':
    case 'depleted':
      return null
  }
}
