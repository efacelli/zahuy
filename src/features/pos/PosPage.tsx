import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { formatMoney } from '../../lib/format'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { OPEN_SESSIONS_KEY, fetchCashRegisters, fetchOpenSessions, openCashSession, type OpenSession } from './pos-api'
import { SaleScreen } from './SaleScreen'
import styles from './Pos.module.css'

/** La caja elegida se recuerda en este equipo (comodidad; si falla, se vuelve a elegir). */
const STORAGE_KEY = 'zahuy.caja.sesion'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Sin almacenamiento: se elige la caja cada vez.
  }
}

/**
 * Caja (etapa 5, propuesta de contrato v0.6.0 §15): elegir o abrir una caja y
 * vender con el lector. Las ventas son comprobantes internos, no facturas (P-27).
 */
export function PosPage() {
  const client = useSupabase()
  const [sessionId, setSessionId] = useState<string | null>(readStored)
  const sessions = useQuery({ queryKey: OPEN_SESSIONS_KEY, queryFn: () => fetchOpenSessions(client) })

  const choose = (id: string | null) => {
    writeStored(id)
    setSessionId(id)
  }

  if (sessions.isPending) return <LoadingState label="Cargando las cajas…" />
  if (sessions.error) {
    const error = toAppError(sessions.error)
    return (
      <>
        <PageHeader title="Caja" />
        <ErrorState
          title={error.kind === 'unavailable' ? 'La caja todavía no está habilitada' : undefined}
          message={
            error.kind === 'unavailable'
              ? 'Falta publicar en la base las tablas de ventas y caja. Cuando estén, esta pantalla funciona sola.'
              : error.message
          }
          onRetry={() => void sessions.refetch()}
        />
      </>
    )
  }

  const session = sessions.data.find((s) => s.cash_session_id === sessionId)
  if (session) return <SaleScreen session={session} onLeave={() => choose(null)} />
  return <SessionPicker sessions={sessions.data} onChoose={choose} />
}

function SessionPicker({ sessions, onChoose }: { sessions: OpenSession[]; onChoose: (id: string) => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const registers = useQuery({ queryKey: ['cash-registers'], queryFn: () => fetchCashRegisters(client) })
  const closed = (registers.data ?? []).filter((r) => !sessions.some((s) => s.cash_register_id === r.id))
  const [registerId, setRegisterId] = useState('')
  const [opening, setOpening] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [key] = useState(newIdempotencyKey)

  const open = useMutation({
    mutationFn: () =>
      openCashSession(client, {
        p_idempotency_key: key,
        p_cash_register_id: registerId || closed[0]?.id || '',
        p_opening_amount: parseDecimalInput(opening) ?? 0,
      }),
    onSuccess: async (row) => {
      await queryClient.invalidateQueries({ queryKey: OPEN_SESSIONS_KEY })
      onChoose(row.id)
    },
    onError: (e) => setError(toAppError(e).message),
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const amount = opening.trim() === '' ? 0 : parseDecimalInput(opening)
    if (amount === null || amount < 0) {
      setError('El efectivo inicial tiene que ser un número mayor o igual a cero.')
      return
    }
    open.mutate()
  }

  return (
    <>
      <PageHeader title="Caja" description="Elegí la caja en la que vas a vender, o abrí una con el efectivo inicial." />
      <div className={styles.pickerGrid}>
        <section className={styles.card} aria-labelledby="pos-open-title">
          <h2 id="pos-open-title" className={styles.subtitle}>
            Cajas abiertas
          </h2>
          {sessions.length === 0 ? (
            <p className={styles.muted}>No hay ninguna caja abierta.</p>
          ) : (
            <ul className={styles.sessionList}>
              {sessions.map((s) => (
                <li key={s.cash_session_id}>
                  <span>
                    <strong>{s.cash_register_name}</strong>
                    <span className={styles.muted}>
                      {' '}
                      · abierta {formatDateTime(s.opened_at)} · {s.sales_count} ventas · {formatMoney(s.sales_total)}
                    </span>
                  </span>
                  <Button variant="primary" onClick={() => onChoose(s.cash_session_id)}>
                    Vender en {s.cash_register_name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form className={styles.card} onSubmit={submit} noValidate aria-labelledby="pos-new-title">
          <h2 id="pos-new-title" className={styles.subtitle}>
            Abrir una caja
          </h2>
          {error && (
            <p className={styles.serverError} role="alert">
              <Icon name="error" size={18} /> {error}
            </p>
          )}
          {registers.isPending ? (
            <p className={styles.muted}>Cargando…</p>
          ) : closed.length === 0 ? (
            <p className={styles.muted}>Todas las cajas están abiertas.</p>
          ) : (
            <>
              <FormField label="Caja" htmlFor="pos-register" required>
                <select
                  id="pos-register"
                  className="select"
                  value={registerId || closed[0]?.id}
                  onChange={(e) => setRegisterId(e.target.value)}
                >
                  {closed.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Efectivo inicial (cambio)" htmlFor="pos-opening" hint="Lo que hay en el cajón al empezar.">
                <input
                  id="pos-opening"
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                />
              </FormField>
              <div className={styles.actions}>
                <Button type="submit" variant="primary" loading={open.isPending}>
                  Abrir caja
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </>
  )
}
