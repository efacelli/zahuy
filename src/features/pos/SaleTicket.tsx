import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { formatDateTime } from '../../lib/dates'
import { formatMoney, formatNumber } from '../../lib/format'
import type { CompletedSale } from './PaymentDialog'
import styles from './Pos.module.css'

/**
 * Ticket interno (P-27): NO es una factura ni un comprobante fiscal. Se puede
 * imprimir; la impresión muestra solo el ticket (estilos de impresión en Pos.module.css).
 */
export function SaleTicket({ sale, registerName, onNext }: { sale: CompletedSale; registerName: string; onNext: () => void }) {
  return (
    <Modal
      open
      title={`Venta n.º ${sale.saleNumber} registrada`}
      onClose={onNext}
      footer={
        <>
          <Button onClick={() => window.print()}>Imprimir ticket</Button>
          <Button variant="primary" onClick={onNext}>
            Nueva venta
          </Button>
        </>
      }
    >
      {sale.change > 0 && (
        <p className={styles.change}>
          Vuelto: <strong>{formatMoney(sale.change)}</strong>
        </p>
      )}
      <div className={styles.ticket} data-print="ticket">
        <p className={styles.ticketHead}>
          <strong>ZAHUY</strong>
          <br />
          Comprobante interno n.º {sale.saleNumber}
          <br />
          {formatDateTime(sale.createdAt)} · {registerName}
        </p>
        <p className={styles.ticketWarning}>NO VÁLIDO COMO FACTURA</p>
        <table>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.name}>
                <td>
                  {formatNumber(l.quantity)} × {l.name}
                </td>
                <td className={styles.num}>{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className={styles.num}>{formatMoney(sale.total)}</td>
            </tr>
            {sale.rounding !== 0 && (
              <tr>
                <th scope="row">Redondeo</th>
                <td className={styles.num}>{formatMoney(sale.rounding)}</td>
              </tr>
            )}
            {sale.payments.map((p) => (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td className={styles.num}>{formatMoney(p.amount)}</td>
              </tr>
            ))}
            {sale.tendered !== null && sale.change > 0 && (
              <>
                <tr>
                  <th scope="row">Recibido</th>
                  <td className={styles.num}>{formatMoney(sale.tendered)}</td>
                </tr>
                <tr>
                  <th scope="row">Vuelto</th>
                  <td className={styles.num}>{formatMoney(sale.change)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>
    </Modal>
  )
}
