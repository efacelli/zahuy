import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { formatDateTime } from '../../lib/dates'
import { formatMoney, formatNumber } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useSupabase } from '../../lib/supabase-context'
import { documentsKey, fetchSaleDocuments } from '../billing/billing-api'
import { BillingSection } from '../billing/BillingSection'
import { useRefreshStock } from '../movements/useRefreshStock'
import { OPEN_SESSIONS_KEY } from '../pos/pos-api'
import { PrintTicketButton } from '../pos/PrintTicketButton'
import { TicketBody } from '../pos/TicketBody'
import { canBeVoided, toTicket, voidSale, type SaleRow } from './sales-api'
import styles from './Sales.module.css'

interface SaleDetailDialogProps {
  sale: SaleRow | null
  /** Encargado o dueño: solo ellos anulan ventas (§15.7). */
  canVoid: boolean
  onClose: () => void
}

/** Detalle de una venta: ticket para reimprimir y, si corresponde, anulación. */
export function SaleDetailDialog({ sale, canVoid, onClose }: SaleDetailDialogProps) {
  if (!sale) return null
  return <DetailContent key={sale.id} sale={sale} canVoid={canVoid} onClose={onClose} />
}

function DetailContent({ sale, canVoid, onClose }: { sale: SaleRow; canVoid: boolean; onClose: () => void }) {
  const client = useSupabase()
  const toast = useToast()
  const queryClient = useQueryClient()
  const refreshStock = useRefreshStock()
  // Una clave por apertura del diálogo: un reintento no anula dos veces (§15.6).
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => voidSale(client, { p_idempotency_key: idempotencyKey, p_sale_id: sale.id, p_reason: reason.trim() }),
    onSuccess: async () => {
      await Promise.all([
        refreshStock(),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: OPEN_SESSIONS_KEY }),
      ])
      toast.success(`Se anuló la venta n.º ${sale.sale_number}. El stock volvió a sus lotes.`)
      onClose()
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function submitVoid() {
    setServerError(null)
    if (reason.trim() === '') {
      setError('Indicá por qué se anula.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  const voidable = canVoid && canBeVoided(sale)
  const fiscalDocuments = useQuery({ queryKey: documentsKey(sale.id), queryFn: () => fetchSaleDocuments(client, sale.id) })
  const hasFiscalTicket = (fiscalDocuments.data ?? []).some((d) => d.status === 'authorized')

  return (
    <Modal
      open
      title={`Venta n.º ${sale.sale_number}`}
      onClose={onClose}
      busy={mutation.isPending}
      footer={
        voiding ? (
          <>
            <Button onClick={() => setVoiding(false)} disabled={mutation.isPending}>
              Volver
            </Button>
            <Button variant="danger" loading={mutation.isPending} onClick={submitVoid}>
              Anular venta
            </Button>
          </>
        ) : (
          <>
            {voidable && (
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Anular…
              </Button>
            )}
            <PrintTicketButton />
            <Button variant="primary" onClick={onClose}>
              Cerrar
            </Button>
          </>
        )
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      <dl className={styles.summary}>
        <dt>Vendió</dt>
        <dd>{sale.seller?.full_name ?? '—'}</dd>
        {sale.notes && (
          <>
            <dt>Notas</dt>
            <dd>{sale.notes}</dd>
          </>
        )}
        {sale.status === 'voided' && (
          <>
            <dt>Anulada</dt>
            <dd>
              {sale.voided_at ? formatDateTime(sale.voided_at) : '—'}
              {sale.voider ? ` por ${sale.voider.full_name}` : ''}
            </dd>
            <dt>Motivo</dt>
            <dd>{sale.void_reason ?? '—'}</dd>
          </>
        )}
      </dl>

      {canVoid && sale.status === 'completed' && !voidable && (
        <p className={styles.note}>
          La caja de esta venta ya se cerró: no se puede anular desde acá (las devoluciones después del cierre quedan para
          una etapa futura).
        </p>
      )}

      <PriceNotes sale={sale} />

      <BillingSection
        saleId={sale.id}
        saleStatus={sale.status}
        items={sale.sale_items.map((i) => ({ name: i.product_name, quantity: i.quantity, lineTotal: i.line_total }))}
      />

      {/* Con un comprobante fiscal autorizado, lo que se imprime es ese comprobante y no el ticket interno. */}
      {!hasFiscalTicket && <TicketBody ticket={toTicket(sale)} />}

      {voiding && (
        <div className={styles.voidForm}>
          <p className={styles.note}>
            No se borra nada: la venta queda marcada como anulada con tu nombre y el stock vuelve a los mismos lotes.
          </p>
          <FormField label="Motivo de la anulación" htmlFor="void-reason" required error={error}>
            <input
              id="void-reason"
              className="input"
              autoComplete="off"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- el foco va al único campo del paso de anulación
              autoFocus
              aria-invalid={error ? true : undefined}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </div>
      )}
    </Modal>
  )
}

/** Las líneas que no se cobraron con el precio de Zahuy (§20), para que se vean al revisar la venta. */
function PriceNotes({ sale }: { sale: SaleRow }) {
  const lines = sale.sale_items.filter((i) => i.price_source !== 'list')
  if (lines.length === 0) return null
  return (
    <ul className={styles.priceNotes} aria-label="Importes que no son del precio de Zahuy">
      {lines.map((i, n) =>
        i.price_source === 'manual' ? (
          <li key={n}>
            <strong>{i.product_name}</strong>: importe de etiqueta de balanza, {formatMoney(i.line_total)} por{' '}
            {formatNumber(i.quantity)} kg.
            {i.catalog_line_total !== null && (
              <> Con el precio de Zahuy hubiera sido {formatMoney(i.catalog_line_total)}{differenceLabel(i.line_total, i.catalog_line_total)}.</>
            )}
          </li>
        ) : (
          <li key={n}>
            <strong>{i.product_name}</strong>: producto sin cargar, {formatMoney(i.line_total)} con IVA{' '}
            {formatNumber(i.vat_rate)} %. No descontó stock.
          </li>
        ),
      )}
    </ul>
  )
}

function differenceLabel(charged: number, catalog: number): string {
  if (catalog <= 0) return ''
  const pct = Math.round(((charged - catalog) / catalog) * 1000) / 10
  if (pct === 0) return ''
  return ` (${pct > 0 ? '+' : '−'}${formatNumber(Math.abs(pct))} %)`
}
