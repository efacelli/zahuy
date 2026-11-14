import { pageCount } from '../../lib/pagination'
import { Button } from './Button'
import styles from './Pagination.module.css'

interface PaginationProps {
  /** Página actual, empezando en 1. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

export function Pagination({ page, pageSize, total, onPageChange, disabled = false }: PaginationProps) {
  const pages = pageCount(total, pageSize)
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <nav className={styles.pagination} aria-label="Paginación">
      <p className={styles.summary} aria-live="polite">
        {total === 0 ? 'Sin resultados' : `Mostrando ${first}–${last} de ${total}`}
      </p>
      <div className={styles.controls}>
        <Button size="sm" icon="chevronLeft" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}>
          Anterior
        </Button>
        <span className={styles.page}>
          Página {page} de {pages}
        </span>
        <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= pages}>
          Siguiente
        </Button>
      </div>
    </nav>
  )
}
