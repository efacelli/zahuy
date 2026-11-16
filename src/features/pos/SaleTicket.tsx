import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { formatMoney } from '../../lib/format'
import type { CompletedSale } from './PaymentDialog'
import { PrintTicketButton } from './PrintTicketButton'
import { TicketBody } from './TicketBody'
import styles from './Pos.module.css'

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
