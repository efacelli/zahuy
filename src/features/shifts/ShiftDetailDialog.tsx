import { useQuery } from '@tanstack/react-query'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { countLabel, formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { DIFFERENCE_LABEL, differenceKind, fetchShiftPayments, type ShiftRow } from './shifts-api'
import styles from './Shifts.module.css'

/** Arqueo de un turno y lo cobrado por medio de pago. */
export function ShiftDetailDialog({ shift, onClose }: { shift: ShiftRow | null; onClose: () => void }) {
  if (!shift) return null
  return <DetailContent shift={shift} onClose={onClose} />
}

function DetailContent({ shift, onClose }: { shift: ShiftRow; onClose: () => void }) {
  const client = useSupabase()
  const payments = useQuery({
    queryKey: ['cash-sessions', 'payments', shift.cash_session_id],
    queryFn: () => fetchShiftPayments(client, shift.cash_session_id),
  })
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v))

  return (
    <Modal
      open
      title={`${shift.cash_register_name} · ${formatDateTime(shift.opened_at)}`}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <dl className={styles.summary}>
        <dt>Abrió</dt>
        <dd>
          {shift.opener?.full_name ?? '—'} · {formatDateTime(shift.opened_at)}
        </dd>
        <dt>Cerró</dt>
        <dd>
          {shift.status === 'open'
            ? 'Sigue abierta'
            : `${shift.closer?.full_name ?? '—'} · ${shift.closed_at ? formatDateTime(shift.closed_at) : '—'}`}
        </dd>
        <dt>Ventas</dt>
        <dd>
          {countLabel(shift.sales_count, 'venta', 'ventas')} por {formatMoney(shift.sales_total)}
          {shift.voided_count > 0 && ` (${countLabel(shift.voided_count, 'anulada', 'anuladas')})`}
        </dd>
        <dt>Redondeo</dt>
        <dd>{money(shift.rounding_total)}</dd>
        <dt>Efectivo inicial</dt>
        <dd>{formatMoney(shift.opening_amount)}</dd>
        <dt>Efectivo cobrado</dt>
        <dd>{money(shift.cash_collected)}</dd>
        <dt>Efectivo esperado</dt>
        <dd>{money(shift.expected_cash)}</dd>
        {shift.status === 'closed' && (
          <>
            <dt>Contado</dt>
            <dd>{money(shift.counted_cash)}</dd>
            <dt>Diferencia</dt>
            <dd>{shift.difference === null ? '—' : <DifferenceBadge value={shift.difference} />}</dd>
          </>
        )}
      </dl>

      <h3 className={styles.sectionTitle}>Por medio de pago</h3>
      {payments.isPending ? (
        <LoadingState />
      ) : payments.error ? (
        <ErrorState message={toAppError(payments.error).message} onRetry={() => void payments.refetch()} />
      ) : payments.data.length === 0 ? (
        <p className={styles.muted}>Sin cobros en este turno.</p>
      ) : (
        <table className={styles.table}>
          <caption className="visually-hidden">Cobrado por medio de pago</caption>
          <thead>
            <tr>
              <th scope="col">Medio</th>
              <th scope="col" className={styles.num}>
                Cobros
              </th>
              <th scope="col" className={styles.num}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.data.map((p) => (
              <tr key={p.payment_method_id}>
                <td>{p.payment_method_name}</td>
                <td className={styles.num}>{formatNumber(p.payments_count)}</td>
                <td className={styles.num}>{formatMoney(p.amount_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

export function DifferenceBadge({ value }: { value: number }) {
  const kind = differenceKind(value)
  return (
    <Badge tone={kind === 'exact' ? 'success' : kind === 'short' ? 'danger' : 'warning'}>
      {DIFFERENCE_LABEL[kind]}
      {kind !== 'exact' && ` ${formatMoney(Math.abs(value))}`}
    </Badge>
  )
}
