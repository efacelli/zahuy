import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { formatMoney } from '../../lib/format'
import type { CompletedSale } from './PaymentDialog'
import { PrintTicketButton } from './PrintTicketButton'
import { TicketBody } from './TicketBody'
import styles from './Pos.module.css'

/**
 * "Guardar sin ticket" con vuelto: la venta ya está registrada y el stock descontado; solo se muestra el
 * vuelto (sin ticket) para que el cajero lo entregue antes de pasar a la próxima venta.
 */
export function SaleSavedNotice({ sale, onNext }: { sale: CompletedSale; onNext: () => void }) {
  return (
    <Modal
      open
      title={`Venta n.º ${sale.saleNumber} guardada sin ticket`}
      onClose={onNext}
      footer={
        <Button variant="primary" onClick={onNext}>
          Nueva venta
        </Button>
      }
    >
      <p className={styles.change}>
        Vuelto: <strong>{formatMoney(sale.change)}</strong>
      </p>
      <p>La venta quedó registrada y el stock ya se descontó. No se emitió ticket.</p>
    </Modal>
  )
}

/** Venta recién cobrada: vuelto bien visible y ticket interno para imprimir (P-27). */
export function SaleTicket({ sale, registerName, onNext }: { sale: CompletedSale; registerName: string; onNext: () => void }) {
  return (
    <Modal
      open
      title={`Venta n.º ${sale.saleNumber} registrada`}
      onClose={onNext}
      footer={
        <>
          <PrintTicketButton />
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
      <TicketBody ticket={{ ...sale, registerName }} />
    </Modal>
  )
}
