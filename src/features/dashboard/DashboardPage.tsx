import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { StatTile } from '../../components/ui/StatTile'
import { MOVEMENT_TYPE_INFO } from '../../domain/movements'
import { formatQuantity } from '../../domain/units'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { countLabel, formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchMovementHistory } from '../movements/movements-api'
import { fetchInventorySummary } from './dashboard-api'
import { FreeLines } from './FreeLines'
import { ProductRanking } from './ProductRanking'
import { CashDifferencesChart, DailyMarginChart, DailySalesChart, PaymentMethodsChart } from './FinanceCharts'
import { fetchFinance, FINANCE_RANGES, type FinanceData, type FinanceRange } from './finance-api'
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
      <PageHeader title="Dashboard" description="Cómo vienen las ventas y la caja, y cómo está el inventario hoy." />

      <FinanceSection />

      <h2 className={styles.blockTitle}>Inventario</h2>
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
        value={formatMoney(s.shrinkage_value_month)}
        detail={`${formatNumber(s.shrinkage_quantity_month)} u. entre mermas, daños y consumo interno de este mes, sin las anuladas. Valor a costo, sin IVA.`}
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

const RANGE_LABEL: Record<FinanceRange, string> = { 7: 'Últimos 7 días', 30: 'Últimos 30 días', 90: 'Últimos 90 días' }

/** Ventas y caja: métricas y gráficos con las vistas de caja (§15.5). */
function FinanceSection() {
  const client = useSupabase()
  const [range, setRange] = useState<FinanceRange>(30)
  const finance = useQuery({
    queryKey: ['dashboard', 'finance', range],
    queryFn: () => fetchFinance(client, range),
    placeholderData: keepPreviousData,
  })

  return (
    <section aria-labelledby="finance-title" className={styles.finance}>
      <div className={styles.financeHeader}>
        <h2 id="finance-title" className={styles.blockTitle}>
          Ventas y caja
        </h2>
        <div className={styles.ranges} role="group" aria-label="Período">
          {FINANCE_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={styles.range}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {finance.isPending ? (
        <LoadingState label="Cargando ventas…" />
      ) : finance.error ? (
        <ErrorState message={toAppError(finance.error).message} onRetry={() => void finance.refetch()} />
      ) : (
        <div className={finance.isFetching ? styles.refetching : undefined}>
          <div className={styles.tiles}>
            <StatTile
              label="Vendido"
              value={formatMoney(finance.data.salesTotal)}
              detail={`${countLabel(finance.data.salesCount, 'venta', 'ventas')}, con IVA.`}
              to="/ventas"
              linkLabel="Ver ventas"
            />
            <StatTile
              label="Ticket promedio"
              value={finance.data.salesCount > 0 ? formatMoney(finance.data.salesTotal / finance.data.salesCount) : '—'}
              detail="Vendido dividido cantidad de ventas."
            />
            <StatTile
              label="Diferencia de caja"
              value={formatMoney(finance.data.differenceTotal)}
              detail="Suma de faltantes (−) y sobrantes (+) de los turnos cerrados."
              status={
                finance.data.differenceTotal < -0.005
                  ? { tone: 'danger', text: 'Faltante' }
                  : finance.data.differenceTotal > 0.005
                    ? { tone: 'warning', text: 'Sobrante' }
                    : { tone: 'success', text: 'Justo' }
              }
              to="/turnos"
              linkLabel="Ver turnos"
            />
            <StatTile
              label="Margen bruto"
              value={formatMoney(finance.data.marginTotal)}
              detail={marginDetail(finance.data)}
              status={finance.data.marginTotal < -0.005 ? { tone: 'danger', text: 'Bajo el costo' } : undefined}
            />
            <StatTile
              label="Descuentos"
              value={formatMoney(finance.data.discountTotal)}
              detail="Descuentos por cantidad hechos en la caja."
            />
            <StatTile
              label="Redondeo"
              value={formatMoney(finance.data.roundingTotal)}
              detail={`Lo que sumó (+) o restó (−) el redondeo. Cajas abiertas ahora: ${formatNumber(finance.data.openSessions)}.`}
            />
          </div>
          <div className={styles.charts}>
            <DailySalesChart days={finance.data.days} />
            <DailyMarginChart days={finance.data.days} />
            <PaymentMethodsChart methods={finance.data.methods} />
            <CashDifferencesChart closings={finance.data.closings} />
          </div>
          <ProductRanking range={range} />
          <FreeLines range={range} />
        </div>
      )}
    </section>
  )
}

/**
 * El margen solo cuenta lo que tiene costo: los productos sin cargar quedan
 * afuera (§20.8) y se informan aparte, para no inflar ni achicar el porcentaje.
 */
function marginDetail(data: FinanceData): string {
  const costed = Math.round((data.netTotal - data.freeNetTotal) * 100) / 100
  if (costed <= 0) return 'Lo vendido sin IVA menos el costo de cada venta.'
  const pct = formatNumber(Math.round((data.marginTotal / costed) * 1000) / 10)
  const base = `${pct} % de lo vendido sin IVA (${formatMoney(costed)}), menos el costo de cada venta.`
  return data.freeNetTotal > 0
    ? `${base} No incluye ${formatMoney(data.freeNetTotal)} sin IVA de productos sin cargar (no tienen costo).`
    : base
}
