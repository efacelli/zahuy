import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge, type BadgeTone } from './Badge'
import styles from './StatTile.module.css'

interface StatTileProps {
  label: string
  value: ReactNode
  /** Línea de contexto debajo del número. */
  detail?: ReactNode
  /** Estado con ícono y texto (nunca solo color). */
  status?: { tone: BadgeTone; text: string }
  /** Enlace a la lista que explica el número. */
  to?: string
  linkLabel?: string
}

/**
 * Tarjeta de métrica. El número usa el color de texto, no el del estado:
 * el estado lo lleva la insignia con ícono y texto (guía de visualización).
 */
export function StatTile({ label, value, detail, status, to, linkLabel = 'Ver detalle' }: StatTileProps) {
  return (
    <article className={styles.tile}>
      <header className={styles.header}>
        <h2 className={styles.label}>{label}</h2>
        {status && <Badge tone={status.tone}>{status.text}</Badge>}
      </header>
      <p className={styles.value}>{value}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      {to && (
        <Link to={to} className={styles.link} aria-label={`${linkLabel}: ${label}`}>
          {linkLabel} →
        </Link>
      )}
    </article>
  )
}
