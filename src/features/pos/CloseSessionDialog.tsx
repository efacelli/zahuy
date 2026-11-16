import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { formatMoney } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { closeCashSession, type OpenSession } from './pos-api'
import styles from './Pos.module.css'

/**
 * Cierre con arqueo (§15.6): se cuenta el efectivo del cajón sin ver lo
 * esperado (arqueo "a ciegas") y la base calcula la diferencia.
 */
export function CloseSessionDialog({ session, onCancel, onClosed }: { session: OpenSession; onCancel: () => void; onClosed: () => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ expected_cash: number; difference: number } | null>(null)

  const close = useMutation({
    mutationFn: () =>
      closeCashSession(client, {
        p_cash_session_id: session.cash_session_id,
        p_counted_cash: parseDecimalInput(counted) ?? 0,
        p_close_notes: notes.trim() === '' ? null : notes.trim(),
      }),
    onSuccess: async (row) => {
      setResult(row)
      await queryClient.invalidateQueries({ queryKey: ['cash-sessions'] })
    },
    onError: (e) => setError(toAppError(e).message),
  })

  function submit() {
    setError(null)
    const n = parseDecimalInput(counted)
    if (counted.trim() === '' || n === null || n < 0) {
      setError('Ingresá el efectivo contado en el cajón.')
      return
    }
    close.mutate()
  }

  if (result) {
    const tone = result.difference === 0 ? 'cuadra' : result.difference < 0 ? 'falta' : 'sobra'
    return (
      <Modal open title={`${session.cash_register_name} cerrada`} onClose={onClosed} footer={<Button variant="primary" onClick={onClosed}>Listo</Button>}>
        <dl className={styles.summary}>
          <dt>Efectivo esperado</dt>
          <dd>{formatMoney(result.expected_cash)}</dd>
          <dt>Contado</dt>
          <dd>{formatMoney(parseDecimalInput(counted))}</dd>
          <dt>Diferencia</dt>
          <dd>
            <strong>
              {formatMoney(result.difference)} ({tone === 'cuadra' ? 'la caja cuadra' : tone === 'falta' ? 'falta efectivo' : 'sobra efectivo'})
            </strong>
          </dd>
        </dl>
      </Modal>
    )
  }

  return (
    <Modal
      open
      title={`Cerrar ${session.cash_register_name}`}
      onClose={onCancel}
      busy={close.isPending}
      footer={
        <>
          <Button onClick={onCancel} disabled={close.isPending}>
            Cancelar
          </Button>
          <Button variant="danger" loading={close.isPending} onClick={submit}>
            Cerrar caja
          </Button>
        </>
      }
    >
      {error && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {error}
        </p>
      )}
      <p className={styles.muted}>
        {session.sales_count} ventas en este turno. Contá el efectivo del cajón (incluido el cambio inicial). Una caja cerrada no se reabre.
      </p>
      <FormField label="Efectivo contado" htmlFor="close-counted" required>
        <input
          id="close-counted"
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
        />
      </FormField>
      <FormField label="Observaciones" htmlFor="close-notes">
        <input id="close-notes" className="input" autoComplete="off" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
    </Modal>
  )
}
