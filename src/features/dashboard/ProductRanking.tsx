import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { formatQuantity } from '../../domain/units'
import { formatDate } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { countLabel, formatMoney } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchRanking, IDLE_SIZE, type RankingMetric, type RankingRow } from './ranking-api'
import pageStyles from './DashboardPage.module.css'
import styles from './ProductRanking.module.css'

const METRIC_LABEL: Record<RankingMetric, string> = { revenue_total: 'Por importe', quantity_sold: 'Por cantidad' }

/** Más vendidos, menos vendidos y sin ventas (contrato §17), para el mismo período que las finanzas. */
export function ProductRanking({ range }: { range: number }) {
  const client = useSupabase()
  const [metric, setMetric] = useState<RankingMetric>('revenue_total')
  const ranking = useQuery({
    queryKey: ['dashboard', 'ranking', range, metric],
    queryFn: () => fetchRanking(client, range, metric),
    placeholderData: keepPreviousData,
  })

  const value = (r: RankingRow) =>
    metric === 'revenue_total' ? formatMoney(r.revenue_total) : formatQuantity(r.quantity_sold, r.sale_unit)
  const detail = (r: RankingRow) =>
    metric === 'revenue_total'
      ? `${formatQuantity(r.quantity_sold, r.sale_unit)} · margen ${formatMoney(r.gross_margin)}`
      : `${formatMoney(r.revenue_total)} · margen ${formatMoney(r.gross_margin)}`

  return (
    <section aria-labelledby="ranking-title" className={styles.section}>
      <div className={pageStyles.financeHeader}>
        <h3 id="ranking-title" className={styles.title}>
          Productos
        </h3>
        <div className={pageStyles.ranges} role="group" aria-label="Ordenar por">
          {(Object.keys(METRIC_LABEL) as RankingMetric[]).map((m) => (
            <button
              key={m}
              type="button"
              className={pageStyles.range}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {ranking.isPending ? (
        <LoadingState label="Cargando productos…" />
      ) : ranking.error ? (
        <ErrorState message={rankingError(ranking.error)} onRetry={() => void ranking.refetch()} />
      ) : (
        <div className={`${styles.grid} ${ranking.isFetching ? pageStyles.refetching : ''}`}>
          <RankingList
            title="Más vendidos"
            subtitle="Solo productos activos, sin las ventas anuladas."
            rows={ranking.data.top}
            value={value}
            detail={detail}
            empty="Sin ventas en el período."
          />
          <RankingList
            title="Menos vendidos"
            subtitle="De los que se vendieron al menos una vez en el período."
            rows={ranking.data.bottom}
            value={value}
            detail={detail}
            empty="Sin ventas en el período."
          />
          <RankingList
            title="Sin ventas en el período"
            subtitle={
              ranking.data.idleCount > IDLE_SIZE
                ? `${countLabel(ranking.data.idleCount, 'producto', 'productos')} con stock; los ${IDLE_SIZE} que más tiempo llevan quietos.`
                : 'Con stock y cargados antes del período: stock inmovilizado.'
            }
            rows={ranking.data.idle}
            value={(r) => formatQuantity(r.stock_quantity, r.sale_unit)}
            detail={(r) => (r.last_sold_at ? `Última venta: ${formatDate(r.last_sold_at.slice(0, 10))}` : 'Nunca se vendió')}
            empty="Todo lo que tiene stock se vendió en el período."
          />
        </div>
      )}
    </section>
  )
}

function RankingList({
  title,
  subtitle,
  rows,
  value,
  detail,
  empty,
}: {
  title: string
  subtitle: string
  rows: RankingRow[]
  value: (r: RankingRow) => string
  detail: (r: RankingRow) => string
  empty: string
}) {
  return (
    <figure className={styles.card}>
      <figcaption className={styles.cardTitle}>{title}</figcaption>
      <p className={styles.subtitle}>{subtitle}</p>
      {rows.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ol className={styles.list} aria-label={title}>
          {rows.map((r) => (
            <li key={r.product_id} className={styles.item}>
              <span className={styles.main}>
                <Link to={`/productos/${r.product_id}`}>{r.name}</Link>
                <span className={styles.muted}>
                  {r.brand_name} · {detail(r)}
                </span>
              </span>
              <span className={styles.value}>{value(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  )
}

/** Si la base todavía no tiene la función (antes de la migración), se dice claro. */
function rankingError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === 'PGRST202' || code === '42883') return 'El ranking de productos todavía no está habilitado en la base.'
  return toAppError(error).message
}
