import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { MOVEMENT_TYPE_INFO } from '../../domain/movements'
import { formatQuantity } from '../../domain/units'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useSupabase } from '../../lib/supabase-context'
import { reverseMovement, type MovementHistoryRow } from './movements-api'
import { useRefreshStock } from './useRefreshStock'
import styles from './Movements.module.css'

interface ReverseMovementDialogProps {
  movement: MovementHistoryRow | null
  onClose: () => void
}

/** Anula un movimiento mal cargado con uno compensatorio (contrato §5.7 y §8.3). */
export function ReverseMovementDialog({ movement, onClose }: ReverseMovementDialogProps) {
  if (!movement) return null
  return <ReverseContent key={movement.id} movement={movement} onClose={onClose} />
}

function ReverseContent({ movement, onClose }: { movement: MovementHistoryRow; onClose: () => void }) {
  const client = useSupabase()
  const toast = useToast()
  const refresh = useRefreshStock()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const product = movement.batch?.product
  const unit = product?.sale_unit ?? 'unit'

  const mutation = useMutation({
    mutationFn: () =>
      reverseMovement(client, { p_idempotency_key: idempotencyKey, p_movement_id: movement.id, p_reason: reason.trim() }),
    onSuccess: async () => {
      await refresh()
      toast.success('Se registró la anulación.')
      onClose()
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function submit() {
    setServerError(null)
    if (reason.trim() === '') {
      setError('Indicá por qué se anula.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Modal
      open
      title="Anular movimiento"
      onClose={onClose}
      busy={mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="danger" loading={mutation.isPending} onClick={submit}>
            Anular
          </Button>
        </>
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      <dl className={styles.summary}>
        <dt>Producto</dt>
        <dd>{product?.name ?? '—'}</dd>
        <dt>Movimiento</dt>
        <dd>
          {MOVEMENT_TYPE_INFO[movement.movement_type].label} de {formatQuantity(movement.quantity, unit)}
        </dd>
        <dt>Fecha</dt>
        <dd>{formatDateTime(movement.occurred_at)}</dd>
      </dl>
      <p className={styles.note}>
        No se borra nada: se registra un movimiento contrario que deja el stock como estaba. Queda en el historial con tu
        nombre.
      </p>
      <FormField label="Motivo de la anulación" htmlFor="reverse-reason" required error={error}>
        <input
          id="reverse-reason"
          className="input"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
    </Modal>
  )
}
