import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchRecentFreeLines, FREE_LINES_LIMIT } from './free-lines-api'
import styles from './ProductRanking.module.css'

/** Lo que se cobró como «Producto sin cargar» en el período (§20.8). */
export function FreeLines({ range }: { range: number }) {
  const client = useSupabase()
  const lines = useQuery({
    queryKey: ['dashboard', 'free-lines', range],
    queryFn: () => fetchRecentFreeLines(client, range),
    placeholderData: keepPreviousData,
  })

  // Sin la migración no hay nada que mostrar.
  if (lines.data === null) return null

  return (
    <section aria-labelledby="free-lines-title" className={styles.section}>
      <h3 id="free-lines-title" className={styles.title}>
        Productos sin cargar
      </h3>
      <p className={styles.subtitle}>
        Cobrados en la caja con descripción e importe, sin descontar stock. Si alguno se repite, conviene{' '}
        <Link to="/productos/nuevo">darlo de alta como producto</Link>.
      </p>
      {lines.isPending ? (
        <LoadingState label="Cargando productos sin cargar…" />
      ) : lines.error ? (
        <ErrorState message={toAppError(lines.error).message} onRetry={() => void lines.refetch()} />
      ) : lines.data.length === 0 ? (
        <p className={styles.empty}>No se cobró ningún producto sin cargar en el período.</p>
      ) : (
        <figure className={styles.card}>
          <figcaption className={styles.cardTitle}>
            {lines.data.length >= FREE_LINES_LIMIT ? `Los últimos ${FREE_LINES_LIMIT}` : 'Últimos cobrados'}
          </figcaption>
          <ul className={styles.list} aria-label="Productos sin cargar cobrados">
            {lines.data.map((l) => (
              <li key={l.key} className={styles.freeItem}>
                <span className={styles.main}>
                  <span>{l.description}</span>
                  <span className={styles.muted}>
                    {formatNumber(l.quantity)} u. · IVA {formatNumber(l.vatRate)} % · venta n.º {l.saleNumber} ·{' '}
                    {formatDateTime(l.createdAt)}
                    {l.seller ? ` · ${l.seller}` : ''}
                  </span>
                </span>
                <span className={styles.value}>{formatMoney(l.total)}</span>
              </li>
            ))}
          </ul>
        </figure>
      )}
    </section>
  )
}
