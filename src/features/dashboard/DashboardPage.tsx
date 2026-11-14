import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { StatTile } from '../../components/ui/StatTile'
import { MOVEMENT_TYPE_INFO } from '../../domain/movements'
import { formatQuantity } from '../../domain/units'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchMovementHistory } from '../movements/movements-api'
import { fetchInventorySummary } from './dashboard-api'
import styles from './DashboardPage.module.css'

const RECENT_MOVEMENTS = 6

/** Resumen del inventario para encargado y dueño (contrato v0.4.0 §7.4). */
export function DashboardPage() {
  const client = useSupabase()
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => fetchInventorySummary(client) })
  const recent = useQuery({
    queryKey: ['movements', { type: null, page: 1 }],
    queryFn: () => fetchMovementHistory(client, { type: null, page: 1 }),
  })

  return (
    <>
      <PageHeader title="Dashboard" description="Cómo está el inventario hoy. Los números salen de la base, no se calculan acá." />

      {summary.isPending ? (
        <LoadingState label="Cargando el resumen…" />
      ) : summary.error ? (
        <ErrorState message={toAppError(summary.error).message} onRetry={() => void summary.refetch()} />
      ) : summary.data === null ? (
        <EmptyState icon="dashboard" title="Sin datos" description="El resumen lo ven el encargado y el dueño." />
      ) : (
        <SummaryTiles s={summary.data} />
      )}

      <section className={styles.recent} aria-labelledby="recent-title">
        <div className={styles.recentHeader}>
          <h2 id="recent-title" className={styles.sectionTitle}>
            Últimos movimientos
          </h2>
          <Link to="/movimientos">Ver todos →</Link>
        </div>
        {recent.isPending ? (
          <LoadingState />
        ) : recent.error ? (
          <ErrorState message={toAppError(recent.error).message} onRetry={() => void recent.refetch()} />
        ) : recent.data.rows.length === 0 ? (
          <p className={styles.muted}>Todavía no hay movimientos.</p>
        ) : (
          <ul className={styles.list}>
            {recent.data.rows.slice(0, RECENT_MOVEMENTS).map((m) => {
              const unit = m.batch?.product?.sale_unit ?? 'unit'
              return (
                <li key={m.id} className={styles.item}>
                  <span className={styles.itemMain}>
                    <strong>{m.batch?.product?.name ?? '—'}</strong>
                    <span className={styles.muted}>
                      {MOVEMENT_TYPE_INFO[m.movement_type].label} · {m.author?.full_name ?? '—'} · {formatDateTime(m.occurred_at)}
                    </span>
                  </span>
                  <span className={styles.qty}>
                    {m.signed_quantity >= 0 ? '+' : '−'}
                    {formatQuantity(Math.abs(m.signed_quantity), unit)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function SummaryTiles({ s }: { s: NonNullable<Awaited<ReturnType<typeof fetchInventorySummary>>> }) {
  return (
    <section className={styles.tiles} aria-label="Resumen del inventario">
      <StatTile label="Productos activos" value={formatNumber(s.active_products)} to="/productos" linkLabel="Ver productos" />
      <StatTile
        label="Stock bajo"
        value={formatNumber(s.low_stock_products)}
        detail="Productos con stock igual o menor al mínimo."
        status={s.low_stock_products > 0 ? { tone: 'warning', text: 'Reponer' } : { tone: 'success', text: 'En orden' }}
        to="/productos?stock=bajo"
        linkLabel="Ver lista"
      />
      <StatTile
        label="Por vencer"
        value={formatNumber(s.expiring_products)}
        detail="Productos con un lote dentro de los días de alerta."
        status={s.expiring_products > 0 ? { tone: 'urgent', text: 'Revisar' } : { tone: 'success', text: 'En orden' }}
        to="/alertas?nivel=proximos"
        linkLabel="Ver alertas"
      />
      <StatTile
        label="Lotes vencidos con stock"
        value={formatNumber(s.expired_batches)}
        detail="Lo vencido no se vende: hay que registrar la merma."
        status={s.expired_batches > 0 ? { tone: 'danger', text: 'Retirar' } : { tone: 'success', text: 'Ninguno' }}
        to="/alertas?nivel=vencidos"
        linkLabel="Ver vencidos"
      />
      <StatTile label="Valor del stock a costo" value={formatMoney(s.stock_value_cost)} detail="Productos activos, sin IVA." />
      <StatTile label="Valor del stock a precio de venta" value={formatMoney(s.stock_value_sale)} detail="Productos activos, con IVA." />
      <StatTile
        label="Mermas del mes"
        value={formatNumber(s.shrinkage_quantity_month)}
        detail="Suma de mermas, daños y consumo interno de este mes (en unidades de cada producto)."
        to="/movimientos?tipo=shrinkage"
        linkLabel="Ver mermas"
      />
      <StatTile
        label="Cajas a revisar"
        value={formatNumber(s.box_mismatch_products)}
        detail="Productos donde las cajas contadas superan el stock."
        status={s.box_mismatch_products > 0 ? { tone: 'urgent', text: 'Contar' } : { tone: 'success', text: 'En orden' }}
      />
    </section>
  )
}
