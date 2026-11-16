import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { formatMoney } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import type { CartLine } from './cart'
import { lineTotal } from './cart'
import { planPayments, type PaymentDraft } from './payment'
import { fetchPaymentMethods, registerSale, type OpenSession, type PaymentMethod } from './pos-api'
import styles from './Pos.module.css'

export interface CompletedSale {
  saleNumber: number
  createdAt: string
  lines: { name: string; quantity: number; lineTotal: number }[]
  total: number
  rounding: number
  toPay: number
  payments: { name: string; amount: number }[]
  tendered: number | null
  change: number
}

const draftFor = (method: PaymentMethod): PaymentDraft => ({ method, amount: '', tendered: '', reference: '' })

export function PaymentDialog({
  session,
  lines,
  total,
  idempotencyKey,
  onCancel,
  onDone,
}: {
  session: OpenSession
  lines: CartLine[]
  total: number
  idempotencyKey: string
  onCancel: () => void
  onDone: (sale: CompletedSale) => void
}) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => fetchPaymentMethods(client), staleTime: 300_000 })
  /** Por defecto, todo en efectivo (lo más común en el mostrador). */
  const [drafts, setDrafts] = useState<PaymentDraft[] | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  const cash = methods.data?.find((m) => m.is_cash)
  const current = drafts ?? (cash ? [draftFor(cash)] : [])
  const plan = planPayments(total, current)

  const update = (methodId: string, patch: Partial<PaymentDraft>) =>
    setDrafts(current.map((d) => (d.method.id === methodId ? { ...d, ...patch } : d)))

  function toggle(method: PaymentMethod) {
    const has = current.some((d) => d.method.id === method.id)
    if (has) {
      setDrafts(current.filter((d) => d.method.id !== method.id))
      return
    }
    // Si es el único medio y no es efectivo, cubre el total; si se suma a otros, el monto lo escribe el cajero.
    const amount = !method.is_cash && current.length === 0 ? String(total).replace('.', ',') : ''
    setDrafts([...current, { ...draftFor(method), amount }])
  }

  /** Cambiar todo a un solo medio (atajo más usado: "pagó con débito"). */
  function only(method: PaymentMethod) {
    setDrafts([{ ...draftFor(method), amount: method.is_cash ? '' : String(total).replace('.', ',') }])
  }

  const sale = useMutation({
    mutationFn: () =>
      registerSale(client, {
        p_idempotency_key: idempotencyKey,
        p_cash_session_id: session.cash_session_id,
        p_items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        p_payments: plan.payments,
        p_notes: null,
      }),
    onSuccess: async (row) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cash-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ])
      const cashPayment = plan.payments.find((p) => p.tendered_amount !== null)
      onDone({
        saleNumber: row.sale_number,
        createdAt: row.created_at,
        lines: lines.map((l) => ({ name: l.product.name, quantity: l.quantity, lineTotal: lineTotal(l) })),
        total: row.total_amount,
        rounding: plan.rounding,
        toPay: plan.toPay,
        payments: plan.payments.map((p) => ({
          name: current.find((d) => d.method.id === p.payment_method_id)?.method.name ?? '',
          amount: p.amount,
        })),
        tendered: cashPayment?.tendered_amount ?? null,
        change: plan.change,
      })
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function confirm() {
    setServerError(null)
    setShowErrors(true)
    if (plan.errors.length === 0) sale.mutate()
  }

  const cashDraft = current.find((d) => d.method.is_cash)

  return (
    <Modal
      open
      size="lg"
      title="Cobrar"
      onClose={onCancel}
      busy={sale.isPending}
      footer={
        <>
          <Button onClick={onCancel} disabled={sale.isPending}>
            Volver al carrito
          </Button>
          <Button variant="primary" loading={sale.isPending} disabled={methods.isPending} onClick={confirm}>
            Confirmar venta
          </Button>
        </>
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      {methods.error && (
        <p className={styles.serverError} role="alert">
          {toAppError(methods.error).message}
        </p>
      )}

      <div className={styles.payTotals}>
        <span>Total de la venta</span>
        <strong>{formatMoney(total)}</strong>
        {cashDraft && plan.rounding !== 0 && (
          <>
            <span>Redondeo del efectivo</span>
            <span>
              {plan.rounding > 0 ? '+' : '−'}
              {formatMoney(Math.abs(plan.rounding))}
            </span>
            <span>A cobrar</span>
            <strong className={styles.toPay}>{formatMoney(plan.toPay)}</strong>
          </>
        )}
      </div>

      <fieldset className={styles.methods}>
        <legend>Medios de pago</legend>
        {methods.data?.map((m) => {
          const active = current.some((d) => d.method.id === m.id)
          return (
            <span key={m.id} className={styles.methodButtons}>
              <Button variant={active ? 'primary' : 'secondary'} aria-pressed={active} onClick={() => toggle(m)}>
                {m.name}
              </Button>
              {!active && (
                <Button size="sm" variant="ghost" onClick={() => only(m)} aria-label={`Todo con ${m.name}`}>
                  solo
                </Button>
              )}
            </span>
          )
        })}
      </fieldset>

      <div className={styles.payRows}>
        {current
          .filter((d) => !d.method.is_cash)
          .map((d) => (
            <div key={d.method.id} className={styles.payRow}>
              <label htmlFor={`pay-${d.method.code}`}>{d.method.name}</label>
              <input
                id={`pay-${d.method.code}`}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                value={d.amount}
                onChange={(e) => update(d.method.id, { amount: e.target.value })}
              />
              <input
                className="input"
                aria-label={`Referencia de ${d.method.name} (opcional)`}
                placeholder="Referencia (opcional, nunca el número de tarjeta)"
                autoComplete="off"
                maxLength={60}
                value={d.reference}
                onChange={(e) => update(d.method.id, { reference: e.target.value })}
              />
            </div>
          ))}

        {cashDraft && (
          <div className={styles.payRow}>
            <span>Efectivo</span>
            <strong>{formatMoney(plan.cashAmount)}</strong>
            <span className={styles.cashInputs}>
              <label htmlFor="pay-tendered">Recibido</label>
              <input
                id="pay-tendered"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder={String(plan.cashAmount)}
                value={cashDraft.tendered}
                onChange={(e) => update(cashDraft.method.id, { tendered: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    confirm()
                  }
                }}
              />
            </span>
          </div>
        )}
      </div>

      {cashDraft && plan.change > 0 && (
        <p className={styles.change} role="status">
          Vuelto: <strong>{formatMoney(plan.change)}</strong>
        </p>
      )}

      {showErrors && plan.errors.length > 0 && (
        <ul className={styles.payErrors} role="alert">
          {plan.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
