import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { formatMoney } from '../../lib/format'
import { newIdempotencyKey } from '../../lib/idempotency'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { fetchOpenSessions, fetchPaymentMethods, OPEN_SESSIONS_KEY } from '../pos/pos-api'
import { CUSTOMERS_KEY, registerCustomerPayment, type CustomerBalance } from './customers-api'
import styles from './Customers.module.css'

/** Cobro de deuda en una caja abierta, parcial o total (§23.1). El efectivo entra al arqueo. */
export function CustomerPaymentDialog({ customer, onClose }: { customer: CustomerBalance; onClose: () => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [key] = useState(newIdempotencyKey)
  const sessions = useQuery({ queryKey: OPEN_SESSIONS_KEY, queryFn: () => fetchOpenSessions(client) })
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => fetchPaymentMethods(client), staleTime: 300_000 })
  const usable = (methods.data ?? []).filter((m) => m.code !== 'account')
  const [sessionId, setSessionId] = useState('')
  const [methodId, setMethodId] = useState('')
  const [amount, setAmount] = useState(String(customer.balance).replace('.', ','))
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const session = sessionId || (sessions.data?.length === 1 ? (sessions.data[0]?.cash_session_id ?? '') : '')
  const method = usable.find((m) => m.id === methodId) ?? usable.find((m) => m.is_cash) ?? null
  const value = parseDecimalInput(amount)
  const tenderedValue = tendered.trim() === '' ? null : parseDecimalInput(tendered)
  const errors = [
    !session && 'Elegí la caja donde entra el pago (tiene que estar abierta).',
    !method && 'Elegí el medio de pago.',
    (value === null || value <= 0) && 'Indicá el monto.',
    value !== null && value > customer.balance && `El pago no puede superar la deuda (${formatMoney(customer.balance)}).`,
    method?.is_cash && tendered.trim() !== '' && (tenderedValue === null || (value !== null && tenderedValue < value)) &&
      'Lo recibido no puede ser menor que el pago.',
  ].filter((e): e is string => typeof e === 'string')
  const change = method?.is_cash && tenderedValue !== null && value !== null && tenderedValue > value ? tenderedValue - value : 0

  const pay = useMutation({
    mutationFn: () =>
      registerCustomerPayment(client, {
        p_idempotency_key: key,
        p_cash_session_id: session,
        p_customer_id: customer.customer_id,
        p_payment_method_id: method!.id,
        p_amount: Math.round((value ?? 0) * 100) / 100,
        p_tendered_amount: method?.is_cash ? (tenderedValue ?? value) : null,
        p_reference: method?.is_cash || reference.trim() === '' ? null : reference.trim(),
        p_notes: null,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['cash-sessions'] }),
      ])
      toast.success(`Pago de ${formatMoney(value ?? 0)} registrado.${change > 0 ? ` Vuelto: ${formatMoney(change)}.` : ''}`)
      onClose()
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function submit() {
    setShowErrors(true)
    setServerError(null)
    if (errors.length === 0) pay.mutate()
  }

  return (
    <Modal
      open
      title={`Cobrar deuda de ${customer.name}`}
      onClose={onClose}
      busy={pay.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={pay.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={pay.isPending} onClick={submit}>
            Registrar pago
          </Button>
        </>
      }
    >
      <p>
        Deuda actual: <strong>{formatMoney(customer.balance)}</strong>
      </p>
      {serverError && (
        <p className={styles.error} role="alert">
          {serverError}
        </p>
      )}
      <div className={styles.form}>
        <FormField label="Caja" htmlFor="cp-session" required>
          <select id="cp-session" className="select" value={session} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">{sessions.data?.length === 0 ? 'No hay ninguna caja abierta' : 'Elegí la caja'}</option>
            {sessions.data?.map((s) => (
              <option key={s.cash_session_id} value={s.cash_session_id}>
                {s.cash_register_name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Medio de pago" htmlFor="cp-method" required>
          <select id="cp-method" className="select" value={method?.id ?? ''} onChange={(e) => setMethodId(e.target.value)}>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Monto" htmlFor="cp-amount" required hint="Puede ser una parte de la deuda.">
          <input id="cp-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        {method?.is_cash ? (
          <FormField label="Recibido" htmlFor="cp-tendered" hint="Opcional, para calcular el vuelto.">
            <input id="cp-tendered" className="input" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} />
          </FormField>
        ) : (
          <FormField label="Referencia" htmlFor="cp-reference" hint="Opcional. Nunca el número de tarjeta.">
            <input id="cp-reference" className="input" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
          </FormField>
        )}
      </div>
      {change > 0 && (
        <p role="status">
          Vuelto: <strong>{formatMoney(change)}</strong>
        </p>
      )}
      {showErrors && errors.length > 0 && (
        <ul className={styles.error} role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
