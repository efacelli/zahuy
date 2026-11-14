import type { ReactNode } from 'react'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import styles from './States.module.css'

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className={styles.state} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  description?: ReactNode
  icon?: IconName
  action?: ReactNode
}

export function EmptyState({ title, description, icon = 'inbox', action }: EmptyStateProps) {
  return (
    <div className={styles.state}>
      <span className={styles.icon}>
        <Icon name={icon} size={32} />
      </span>
      <p className={styles.title}>{title}</p>
      {description && <div className={styles.description}>{description}</div>}
      {action}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
  title?: string
  /** Acción adicional (por ejemplo, "Salir"). */
  action?: ReactNode
}

export function ErrorState({ message, onRetry, title = 'No se pudo cargar la información', action }: ErrorStateProps) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <span className={styles.icon}>
        <Icon name="error" size={32} />
      </span>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{message}</p>
      {(onRetry || action) && (
        <div className={styles.actions}>
          {onRetry && <Button onClick={onRetry}>Reintentar</Button>}
          {action}
        </div>
      )}
    </div>
  )
}
