import { Fragment } from 'react'
import { formatDateTime } from '../../lib/dates'
import { formatMoney, formatNumber } from '../../lib/format'
import { pageRule, useTicketPaper } from './ticket-paper'
import styles from './Pos.module.css'

export interface TicketLine {
  name: string
  quantity: number
  /** Lo cobrado por la línea, ya con el descuento. */
  lineTotal: number
  /** Descuento por cantidad aplicado (§16); 0 o ausente si no hubo. */
  discountPercent?: number
  discountAmount?: number
}

/** Datos que muestra el ticket interno, venga de la caja recién cobrada o del historial. */
export interface TicketData {
  saleNumber: number
  createdAt: string
  registerName: string
  lines: TicketLine[]
  total: number
  rounding: number
  payments: { name: string; amount: number }[]
  tendered: number | null
  change: number
  /** Venta anulada: el ticket lo dice bien visible. */
  voided?: boolean
}

/**
 * Ticket interno (P-27): NO es una factura ni un comprobante fiscal. Al imprimir
 * se muestra solo este bloque (estilos de impresión en Pos.module.css).
 */
export function TicketBody({ ticket }: { ticket: TicketData }) {
  const [paper] = useTicketPaper()
  return (
    <div className={styles.ticket} data-print="ticket" data-paper={paper}>
      <style media="print">{pageRule(paper)}</style>
      <p className={styles.ticketHead}>
        <strong>ZAHUY</strong>
        <br />
        Comprobante interno n.º {ticket.saleNumber}
        <br />
        {formatDateTime(ticket.createdAt)} · {ticket.registerName}
      </p>
      <p className={styles.ticketWarning}>NO VÁLIDO COMO FACTURA</p>
      {ticket.voided && <p className={styles.ticketWarning}>VENTA ANULADA</p>}
      <table>
        <tbody>
          {ticket.lines.map((l) => (
            <Fragment key={l.name}>
              <tr>
                <td>
                  {formatNumber(l.quantity)} × {l.name}
                </td>
                <td className={styles.num}>{formatMoney(l.lineTotal + (l.discountAmount ?? 0))}</td>
              </tr>
              {(l.discountAmount ?? 0) > 0 && (
                <tr>
                  <td>&nbsp;&nbsp;Desc. {formatNumber(l.discountPercent ?? 0)} %</td>
                  <td className={styles.num}>−{formatMoney(l.discountAmount ?? 0)}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className={styles.num}>{formatMoney(ticket.total)}</td>
          </tr>
          {ticket.rounding !== 0 && (
            <tr>
              <th scope="row">Redondeo</th>
              <td className={styles.num}>{formatMoney(ticket.rounding)}</td>
            </tr>
          )}
          {ticket.payments.map((p) => (
            <tr key={p.name}>
              <th scope="row">{p.name}</th>
              <td className={styles.num}>{formatMoney(p.amount)}</td>
            </tr>
          ))}
          {ticket.tendered !== null && ticket.change > 0 && (
            <>
              <tr>
                <th scope="row">Recibido</th>
                <td className={styles.num}>{formatMoney(ticket.tendered)}</td>
              </tr>
              <tr>
                <th scope="row">Vuelto</th>
                <td className={styles.num}>{formatMoney(ticket.change)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
    </div>
  )
}
