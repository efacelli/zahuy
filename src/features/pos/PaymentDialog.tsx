import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { DEFAULT_CASH_STEP } from '../../domain/cash-rounding'
import { formatMoney } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { CUSTOMERS_KEY, fetchCustomers, registerAccountSale } from '../customers/customers-api'
import { lineName, toSaleItem, type PricedCart } from './cart'
import { planPayments, type PaymentDraft } from './payment'
import { fetchPaymentMethods, fetchRoundingMultiple, registerSale, type OpenSession, type PaymentMethod } from './pos-api'
import type { TicketLine } from './TicketBody'
import styles from './Pos.module.css'

export interface CompletedSale {
  saleNumber: number
  createdAt: string
  lines: TicketLine[]
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
  cart,
  idempotencyKey,
  onCancel,
  onDone,
}: {
  session: OpenSession
  cart: PricedCart
  idempotencyKey: string
  onCancel: () => void
  /** `withTicket = false`: "Guardar sin ticket" (la venta se registra y descuenta stock igual). */
  onDone: (sale: CompletedSale, options: { withTicket: boolean }) => void
}) {
  const client = useSupabase()
  const { lines, total } = cart
  const queryClient = useQueryClient()
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => fetchPaymentMethods(client), staleTime: 300_000 })
  /** Por defecto, todo en efectivo (lo más común en el mostrador). */
  const [drafts, setDrafts] = useState<PaymentDraft[] | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  /** Monto a cobrar escrito por el cajero; null = el sugerido (total redondeado). */
  const [charged, setCharged] = useState<string | null>(null)
  /** Cuenta corriente (§23): cliente elegido y, si supera el límite, la autorización del encargado o el dueño. */
  const [customerId, setCustomerId] = useState('')
  const [overLimit, setOverLimit] = useState(false)
  const [allowOverLimit, setAllowOverLimit] = useState(false)
  const canAuthorize = usePermissions().manageCustomers

  const cash = methods.data?.find((m) => m.is_cash)
  const current = drafts ?? (cash ? [draftFor(cash)] : [])
  const multiple = useQuery({ queryKey: ['rounding-multiple'], queryFn: () => fetchRoundingMultiple(client), staleTime: 300_000 })
  const step = multiple.data ?? DEFAULT_CASH_STEP
  const plan = planPayments(total, current, charged ?? '', step)
  const single = current.length === 1
  const isAccount = current.some((d) => d.method.code === 'account')
  const customers = useQuery({
    queryKey: CUSTOMERS_KEY,
    queryFn: () => fetchCustomers(client),
    enabled: isAccount,
  })
  const activeCustomers = (customers.data ?? []).filter((c) => c.is_active)
  const customer = activeCustomers.find((c) => c.customer_id === customerId) ?? null
  const accountErrors = isAccount && !customer ? ['Elegí el cliente de la cuenta corriente.'] : []
  const errors = [...plan.errors, ...accountErrors]

  const update = (methodId: string, patch: Partial<PaymentDraft>) =>
    setDrafts(current.map((d) => (d.method.id === methodId ? { ...d, ...patch } : d)))

  function toggle(method: PaymentMethod) {
    const has = current.some((d) => d.method.id === method.id)
    if (has) {
      setDrafts(current.filter((d) => d.method.id !== method.id))
      return
    }
    // Con un solo medio paga todo; al combinar, el cajero escribe los montos y el efectivo cubre lo que falta.
    setDrafts([...current, draftFor(method)])
  }

  /** Cambiar todo a un solo medio (atajo más usado: "pagó con débito"). */
  function only(method: PaymentMethod) {
    setDrafts([draftFor(method)])
  }

  const sale = useMutation({
    mutationFn: (_withTicket: boolean) =>
    {
      const params = {
        p_idempotency_key: idempotencyKey,
        p_cash_session_id: session.cash_session_id,
        p_items: lines.map(toSaleItem),
        p_payments: plan.payments,
        p_notes: null,
      }
      return isAccount && customer
        ? registerAccountSale(client, { ...params, p_customer_id: customer.customer_id, p_allow_over_limit: allowOverLimit })
        : registerSale(client, params)
    },
    onSuccess: async (row, withTicket) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cash-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY }),
      ])
      const cashPayment = plan.payments.find((p) => p.tendered_amount !== null)
      onDone(
        {
          saleNumber: row.sale_number,
          createdAt: row.created_at,
          lines: lines.map((l) => ({
            name: lineName(l),
            manual: l.kind !== 'product',
            quantity: l.quantity,
            lineTotal: l.total,
            discountPercent: l.appliedPercent,
            discountAmount: l.discountAmount,
          })),
          total: row.total_amount,
          rounding: plan.rounding,
          toPay: plan.toPay,
          payments: plan.payments.map((p) => {
            const method = current.find((d) => d.method.id === p.payment_method_id)?.method
            const name = method?.name ?? ''
            return { name: method?.code === 'account' && customer ? `${name} · ${customer.name}` : name, amount: p.amount }
          }),
          tendered: cashPayment?.tendered_amount ?? null,
          change: plan.change,
        },
        { withTicket },
      )
    },
    onError: (e) => {
      const err = toAppError(e)
      setOverLimit(err.code === 'CREDIT_LIMIT_EXCEEDED')
      setServerError(
        err.code === 'CREDIT_LIMIT_EXCEEDED' && !canAuthorize
          ? `${err.message} Pedile que la autorice desde Clientes y volvé a confirmar.`
          : err.message,
      )
    },
  })

  function confirm(withTicket = true) {
    setServerError(null)
    setShowErrors(true)
    if (errors.length === 0) sale.mutate(withTicket)
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
          <Button disabled={sale.isPending || methods.isPending} onClick={() => confirm(false)}>
            Guardar sin ticket
          </Button>
          <Button variant="primary" loading={sale.isPending} disabled={methods.isPending} onClick={() => confirm()}>
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
        {plan.rounding !== 0 && (
          <>
            <span>Redondeo</span>
            <span>
              {plan.rounding > 0 ? '+' : '−'}
              {formatMoney(Math.abs(plan.rounding))}
            </span>
          </>
        )}
        <label htmlFor="pay-charged">A cobrar</label>
        <span className={styles.chargedField}>
          <input
            id="pay-charged"
            className={`input ${styles.chargedInput}`}
            inputMode="decimal"
            autoComplete="off"
            aria-describedby="pay-charged-hint"
            value={charged ?? String(plan.suggested).replace('.', ',')}
            onChange={(e) => setCharged(e.target.value)}
          />
          {charged !== null && (
            <Button size="sm" variant="ghost" onClick={() => setCharged(null)}>
              Usar {formatMoney(plan.suggested)}
            </Button>
          )}
        </span>
        <span id="pay-charged-hint" className={styles.chargedHint}>
          Redondeado a {formatMoney(step)} (menos de {formatMoney(step / 2)}, exacto). Se puede cambiar si hace falta.
        </span>
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
              {single ? (
                <strong>{formatMoney(plan.toPay)}</strong>
              ) : (
                <input
                  id={`pay-${d.method.code}`}
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={d.amount}
                  onChange={(e) => update(d.method.id, { amount: e.target.value })}
                />
              )}
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

      {isAccount && (
        <div className={styles.payRow}>
          <label htmlFor="pay-customer">Cliente</label>
          <select
            id="pay-customer"
            className="select"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value)
              setOverLimit(false)
              setAllowOverLimit(false)
            }}
          >
            <option value="">{customers.isPending ? 'Cargando clientes…' : 'Elegí el cliente'}</option>
            {activeCustomers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.name}
                {c.document_number ? ` (${c.document_number})` : ''}
                {c.is_blocked ? ' — BLOQUEADO' : ` — disponible ${formatMoney(c.available_credit)}`}
              </option>
            ))}
          </select>
          {customer && (
            <span className={styles.chargedHint}>
              Debe {formatMoney(customer.balance)} · límite {formatMoney(customer.credit_limit)}
              {customer.over_limit_authorized_until && ' · exceso autorizado por el encargado'}
            </span>
          )}
        </div>
      )}
      {isAccount && overLimit && canAuthorize && (
        <label className={styles.payRow}>
          <input type="checkbox" checked={allowOverLimit} onChange={(e) => setAllowOverLimit(e.target.checked)} />
          Autorizo esta venta por encima del límite (encargado o dueño)
        </label>
      )}

      {showErrors && errors.length > 0 && (
        <ul className={styles.payErrors} role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
