import { useState } from 'react'
import { countLabel, formatMoney, formatNumber } from '../../lib/format'
import type { DayTotal, FinanceData } from './finance-api'
import styles from './FinanceCharts.module.css'

/*
 * Gráficos hechos con HTML y CSS (sin dependencias). Siguen la guía de
 * visualización: una sola serie por gráfico (sin leyenda), barras finas con
 * esquina redondeada en la punta, tooltip al pasar el mouse o con el teclado, y
 * una tabla con los mismos números para no depender del gráfico.
 */

const dayLabel = (day: string) => {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}

function DataTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [string, string][] }) {
  return (
    <details className={styles.tableToggle}>
      <summary>Ver como tabla</summary>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{head[0]}</th>
            <th scope="col" className={styles.num}>
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <th scope="row">{a}</th>
              <td className={styles.num}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** Ventas por día: barras verticales, una sola serie. */
export function DailySalesChart({ days }: { days: DayTotal[] }) {
  const [active, setActive] = useState<DayTotal | null>(null)
  const max = Math.max(...days.map((d) => d.total), 0)
  const labelEvery = Math.max(1, Math.ceil(days.length / 7))
  return (
    <figure className={styles.card}>
      <figcaption className={styles.title}>Ventas por día</figcaption>
      <p className={styles.subtitle}>Con IVA, por día de apertura del turno.</p>
      <div className={styles.plot}>
        <div className={styles.yMax} aria-hidden="true">
          {formatMoney(max)}
        </div>
        <div className={styles.bars}>
          {days.map((d) => (
            <button
              key={d.day}
              type="button"
              className={styles.barSlot}
              aria-label={`${dayLabel(d.day)}: ${formatMoney(d.total)}, ${countLabel(d.count, 'venta', 'ventas')}`}
              onPointerEnter={() => setActive(d)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(d)}
              onBlur={() => setActive(null)}
            >
              <span
                className={`${styles.bar} ${active?.day === d.day ? styles.barActive : ''}`}
                style={{ height: max > 0 ? `${(d.total / max) * 100}%` : '0%' }}
              />
            </button>
          ))}
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.day}>{i % labelEvery === 0 || i === days.length - 1 ? dayLabel(d.day) : ''}</span>
          ))}
        </div>
        {active && (
          <div className={styles.tooltip} role="status">
            <strong>{formatMoney(active.total)}</strong>
            <span>
              {dayLabel(active.day)} · {countLabel(active.count, 'venta', 'ventas')}
            </span>
          </div>
        )}
      </div>
      <DataTable
        caption="Ventas por día"
        head={['Día', 'Vendido']}
        rows={days.map((d) => [dayLabel(d.day), `${formatMoney(d.total)} (${formatNumber(d.count)})`])}
      />
    </figure>
  )
}

/** Cobrado por medio de pago: barras horizontales con el valor escrito. */
export function PaymentMethodsChart({ methods }: { methods: FinanceData['methods'] }) {
  const max = Math.max(...methods.map((m) => m.total), 0)
  const sum = methods.reduce((a, m) => a + m.total, 0)
  return (
    <figure className={styles.card}>
      <figcaption className={styles.title}>Cobrado por medio de pago</figcaption>
      <p className={styles.subtitle}>Lo que entró por cada medio, con el redondeo.</p>
      {methods.length === 0 ? (
        <p className={styles.empty}>Sin cobros en el período.</p>
      ) : (
        <ul className={styles.hbars}>
          {methods.map((m) => (
            <li key={m.name} className={styles.hbarRow}>
              <span className={styles.hbarLabel}>{m.name}</span>
              <span className={styles.hbarTrack}>
                <span className={styles.hbar} style={{ width: max > 0 ? `${(m.total / max) * 100}%` : '0%' }} />
              </span>
              <span className={styles.hbarValue}>
                {formatMoney(m.total)}
                <span className={styles.muted}> · {sum > 0 ? Math.round((m.total / sum) * 100) : 0}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

/** Diferencias de arqueo por turno cerrado: divergente, faltante a la izquierda. */
export function CashDifferencesChart({ closings }: { closings: FinanceData['closings'] }) {
  const max = Math.max(...closings.map((c) => Math.abs(c.difference)), 0)
  return (
    <figure className={styles.card}>
      <figcaption className={styles.title}>Diferencias de caja por turno</figcaption>
      <p className={styles.subtitle}>Contado menos esperado. A la izquierda, faltante; a la derecha, sobrante.</p>
      {closings.length === 0 ? (
        <p className={styles.empty}>No hay turnos cerrados en el período.</p>
      ) : (
        <ul className={styles.hbars}>
          {closings.map((c) => {
            const width = max > 0 ? `${(Math.abs(c.difference) / max) * 50}%` : '0%'
            const kind = Math.abs(c.difference) < 0.005 ? 'Justo' : c.difference < 0 ? 'Faltante' : 'Sobrante'
            return (
              <li key={c.id} className={styles.hbarRow}>
                <span className={styles.hbarLabel}>{c.label}</span>
                <span className={styles.divTrack}>
                  <span className={styles.divAxis} />
                  {c.difference < 0 && <span className={styles.divNeg} style={{ width }} />}
                  {c.difference > 0 && <span className={styles.divPos} style={{ width }} />}
                </span>
                <span className={styles.hbarValue}>
                  {kind}
                  {kind !== 'Justo' && ` ${formatMoney(Math.abs(c.difference))}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </figure>
  )
}
