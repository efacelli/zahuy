import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './Badge.module.css'

export type BadgeTone = 'neutral' | 'success' | 'info' | 'warning' | 'urgent' | 'danger'

const DEFAULT_ICON: Partial<Record<BadgeTone, IconName>> = {
  success: 'check',
  warning: 'clock',
  urgent: 'warning',
  danger: 'error',
}

interface BadgeProps {
  tone?: BadgeTone
  /** Ícono opcional; por defecto cada tono tiene uno para no depender solo del color. */
  icon?: IconName | null
  children: ReactNode
}

export function Badge({ tone = 'neutral', icon, children }: BadgeProps) {
  const iconName = icon === null ? undefined : (icon ?? DEFAULT_ICON[tone])
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {iconName && <Icon name={iconName} size={14} />}
      {children}
    </span>
  )
}
