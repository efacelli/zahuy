import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { formatDateTime } from '../../lib/dates'
import { formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchStoreInfo, formatTaxId, STORE_INFO_KEY } from '../settings/sales-settings-api'
import { chargedTotal } from './ticket-total'
import { pageRule, useTicketPaper } from './ticket-paper'
import styles from './Pos.module.css'

export interface TicketLine {
  name: string
  /** Importe escrito en la caja (etiqueta de balanza o producto sin cargar, §20). */
  manual?: boolean
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
  /** Redondeo del efectivo: no se imprime; el total del ticket ya lo incluye. */
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
  const client = useSupabase()
  // Encabezado del comercio (§18): si falta o falla, el ticket sale como siempre.
  const store = useQuery({ queryKey: STORE_INFO_KEY, queryFn: () => fetchStoreInfo(client), staleTime: 300_000 }).data
  return (
    <div className={styles.ticket} data-print="ticket" data-paper={paper}>
      <style media="print">{pageRule(paper)}</style>
      {/* Logo en blanco y negro puro: las impresoras de tickets no imprimen grises ni colores. */}
      <img className={styles.ticketLogo} src="/ticket-logo.png" alt={store?.store_name ?? 'ZAHUY'} />
      <p className={styles.ticketHead}>
        {store?.store_address && (
          <>
            {store.store_address}
            <br />
          </>
        )}
        {store?.store_tax_id && (
          <>
            CUIT {formatTaxId(store.store_tax_id)}
            <br />
          </>
        )}
        Comprobante interno n.º {ticket.saleNumber}
        <br />
        {formatDateTime(ticket.createdAt)} · {ticket.registerName}
      </p>
      <p className={styles.ticketWarning}>NO VÁLIDO COMO FACTURA</p>
      {ticket.voided && <p className={styles.ticketWarning}>VENTA ANULADA</p>}
      <table>
        <tbody>
          {ticket.lines.map((l, i) => (
            <Fragment key={i}>
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
            <td className={styles.num}>{formatMoney(chargedTotal(ticket))}</td>
          </tr>
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
