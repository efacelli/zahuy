import { ALERT_LEVEL_LABEL, alertLevelFor, daysLabel, type ExpiryStatus } from '../../domain/expiry'
import { daysUntil, formatDate, isIsoDate } from '../../lib/dates'
import { Badge, type BadgeTone } from '../ui/Badge'
import styles from './ExpiryBadge.module.css'

const TONE = { warning: 'warning', urgent: 'urgent', expired: 'danger' } as const satisfies Record<string, BadgeTone>

interface ExpiryBadgeProps {
  expiresOn: string | null
  /** Estado calculado por la base (contrato §4.4). */
  status: ExpiryStatus | null
  /** Fecha de hoy (Argentina); se inyecta en pruebas. */
  today?: string
}

/**
 * Fecha de vencimiento + días restantes + nivel de alerta.
 * El nivel sale de la base; los días se cuentan con la fecha de hoy en Argentina.
 */
export function ExpiryBadge({ expiresOn, status, today }: ExpiryBadgeProps) {
  if (!expiresOn || !isIsoDate(expiresOn)) {
    return <span className={styles.muted}>{status === 'no_expiry' ? 'No vence' : '—'}</span>
  }
  const days = daysUntil(expiresOn, today)
  const level = status ? alertLevelFor(status) : null
  return (
    <span className={styles.cell}>
      <span>{formatDate(expiresOn)}</span>
      {level ? (
        <Badge tone={TONE[level]}>
          <span className="visually-hidden">{ALERT_LEVEL_LABEL[level]}: </span>
          {daysLabel(days)}
        </Badge>
      ) : (
        <span className={styles.muted}>{daysLabel(days)}</span>
      )}
    </span>
  )
}
