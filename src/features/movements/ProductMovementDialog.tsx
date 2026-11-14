import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { MOVEMENT_TYPE_INFO, type MovementType } from '../../domain/movements'
import { SALE_UNIT_LABEL, formatQuantity } from '../../domain/units'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import {
  occurredAtParam,
  optional,
  validateMovement,
  type FieldErrors,
  type MovementFormValues,
} from './movement-forms'
import { registerProductMovement, type ProductOption } from './movements-api'
import { ProductPicker } from './ProductPicker'
import { useRefreshStock } from './useRefreshStock'
import styles from './Movements.module.css'

interface ProductMovementDialogProps {
  open: boolean
  /** Tipos que el rol puede registrar (§9). */
  types: MovementType[]
  onClose: () => void
}

/**
 * Salida, merma, ajuste, devolución o consumo interno por producto.
 * La base elige los lotes empezando por el que vence primero (contrato §8.7).
 */
export function ProductMovementDialog({ open, types, onClose }: ProductMovementDialogProps) {
  if (!open || types.length === 0) return null
  return <ProductMovementContent types={types} onClose={onClose} />
}

function ProductMovementContent({ types, onClose }: { types: MovementType[]; onClose: () => void }) {
  const client = useSupabase()
  const toast = useToast()
  const refresh = useRefreshStock()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [product, setProduct] = useState<ProductOption | null>(null)
  const [values, setValues] = useState<MovementFormValues>({
    movement_type: types[0] ?? 'internal_use',
    quantity: '',
    reason: '',
    notes: '',
    occurred_at: '',
  })
  const [errors, setErrors] = useState<FieldErrors<MovementFormValues> & { product?: string }>({})
  const [confirming, setConfirming] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const set = <K extends keyof MovementFormValues>(key: K, value: MovementFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const info = MOVEMENT_TYPE_INFO[values.movement_type]
  const quantity = parseDecimalInput(values.quantity) ?? 0

  const mutation = useMutation({
    mutationFn: () =>
      registerProductMovement(client, {
        p_idempotency_key: idempotencyKey,
        p_product_id: product?.id ?? '',
        p_movement_type: values.movement_type,
        p_quantity: quantity,
        p_reason: optional(values.reason),
        p_notes: optional(values.notes),
        p_occurred_at: occurredAtParam(values.occurred_at),
      }),
    onSuccess: async (rows) => {
      await refresh()
      const lots = rows.length === 1 ? '1 lote' : `${rows.length} lotes`
      toast.success(
        `${info.label}: ${formatQuantity(quantity, product?.sale_unit ?? 'unit')} de "${product?.name}" (${lots}).`,
      )
      onClose()
    },
    onError: (error) => {
      setConfirming(false)
      setServerError(toAppError(error).message)
    },
  })

  function review() {
    setServerError(null)
    const next = product ? validateMovement(values, product.sale_unit) : {}
    const all = product ? next : { ...next, product: 'Elegí el producto.' }
    setErrors(all)
    if (Object.keys(all).length === 0) setConfirming(true)
  }

  const title = confirming ? `Confirmar: ${info.label.toLowerCase()}` : 'Registrar salida o ajuste'

  return (
    <Modal
      open
      size="lg"
      title={title}
      onClose={onClose}
      busy={mutation.isPending}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={mutation.isPending}>
              Volver
            </Button>
            <Button
              variant={info.direction === 'out' ? 'danger' : 'primary'}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Registrar {info.label.toLowerCase()}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={review}>
              Revisar
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

      {confirming && product ? (
        <>
          <dl className={styles.summary}>
            <dt>Producto</dt>
            <dd>
              {product.name} <span className={styles.muted}>(SKU {product.sku})</span>
            </dd>
            <dt>Tipo</dt>
            <dd>{info.label}</dd>
            <dt>Cantidad</dt>
            <dd>
              {info.direction === 'out' ? '−' : '+'}
              {formatQuantity(quantity, product.sale_unit)}
            </dd>
            {optional(values.reason) && (
              <>
                <dt>Motivo</dt>
                <dd>{values.reason}</dd>
              </>
            )}
            <dt>Fecha</dt>
            <dd>{values.occurred_at ? formatDateTime(occurredAtParam(values.occurred_at)) : 'Ahora'}</dd>
          </dl>
          <p className={styles.note}>
            {info.direction === 'out'
              ? 'El sistema descuenta del lote que vence primero y, si no alcanza, sigue con el siguiente.'
              : 'Se suma al lote con stock que vence más tarde.'}
          </p>
        </>
      ) : (
        <div className={styles.form}>
          <FormField label="Producto" htmlFor="movement-product" required error={errors.product}>
            <ProductPicker id="movement-product" value={product} onChange={setProduct} error={errors.product} />
          </FormField>
          <div className={styles.grid}>
            <FormField label="Tipo de movimiento" htmlFor="movement-type" required>
              <select
                id="movement-type"
                className="select"
                value={values.movement_type}
                onChange={(e) => set('movement_type', e.target.value as MovementType)}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_TYPE_INFO[t].label} ({MOVEMENT_TYPE_INFO[t].direction === 'out' ? 'resta' : 'suma'})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label={`Cantidad (${product ? SALE_UNIT_LABEL[product.sale_unit].toLowerCase() : 'unidades'})`}
              htmlFor="movement-quantity"
              required
              error={errors.quantity}
            >
              <input
                id="movement-quantity"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={errors.quantity ? true : undefined}
                value={values.quantity}
                onChange={(e) => set('quantity', e.target.value)}
              />
            </FormField>
            <FormField label="Motivo" htmlFor="movement-reason" required={info.reasonRequired} error={errors.reason}>
              <input
                id="movement-reason"
                className="input"
                autoComplete="off"
                placeholder={values.movement_type === 'shrinkage' ? 'Por ejemplo: vencido, se tira' : undefined}
                aria-invalid={errors.reason ? true : undefined}
                value={values.reason}
                onChange={(e) => set('reason', e.target.value)}
              />
            </FormField>
            <FormField
              label="Fecha y hora"
              htmlFor="movement-occurred_at"
              error={errors.occurred_at}
              hint="Vacío = ahora. Se puede cargar con hasta 7 días de atraso."
            >
              <input
                id="movement-occurred_at"
                type="datetime-local"
                className="input"
                value={values.occurred_at}
                onChange={(e) => set('occurred_at', e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Observaciones" htmlFor="movement-notes">
            <input
              id="movement-notes"
              className="input"
              autoComplete="off"
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </FormField>
        </div>
      )}
    </Modal>
  )
}
