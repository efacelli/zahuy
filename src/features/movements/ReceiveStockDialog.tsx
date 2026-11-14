import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { SALE_UNIT_LABEL, formatQuantity } from '../../domain/units'
import { formatDate, todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useSupabase } from '../../lib/supabase-context'
import {
  emptyReceiveForm,
  optional,
  receiveQuantity,
  validateReceive,
  type FieldErrors,
  type ReceiveFormValues,
} from './movement-forms'
import { receiveStock, type ProductOption } from './movements-api'
import { ProductPicker } from './ProductPicker'
import { useRefreshStock } from './useRefreshStock'
import styles from './Movements.module.css'

interface ReceiveStockDialogProps {
  open: boolean
  onClose: () => void
}

/** Ingreso de mercadería: crea un lote nuevo con su vencimiento (contrato §8.1). */
export function ReceiveStockDialog({ open, onClose }: ReceiveStockDialogProps) {
  if (!open) return null
  return <ReceiveStockContent onClose={onClose} />
}

function ReceiveStockContent({ onClose }: { onClose: () => void }) {
  const client = useSupabase()
  const toast = useToast()
  const refresh = useRefreshStock()
  const today = todayInAppTimeZone()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [product, setProduct] = useState<ProductOption | null>(null)
  const [values, setValues] = useState<ReceiveFormValues>(() => emptyReceiveForm(today))
  const [errors, setErrors] = useState<FieldErrors<ReceiveFormValues> & { product?: string }>({})
  const [confirming, setConfirming] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const set = <K extends keyof ReceiveFormValues>(key: K, value: ReceiveFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const units = product ? receiveQuantity(values, product.units_per_box) : 0

  const mutation = useMutation({
    mutationFn: () =>
      receiveStock(client, {
        p_idempotency_key: idempotencyKey,
        p_product_id: product?.id ?? '',
        p_quantity: units,
        p_received_on: values.received_on,
        p_expires_on: values.expires_on,
        p_batch_number: optional(values.batch_number),
        p_notes: optional(values.notes),
      }),
    onSuccess: async () => {
      await refresh()
      toast.success(`Ingresaron ${formatQuantity(units, product?.sale_unit ?? 'unit')} de "${product?.name}".`)
      onClose()
    },
    onError: (error) => {
      setConfirming(false)
      setServerError(toAppError(error).message)
    },
  })

  function review() {
    setServerError(null)
    const next = product ? validateReceive(values, product.sale_unit, today) : {}
    const all = product ? next : { ...next, product: 'Elegí el producto.' }
    setErrors(all)
    if (Object.keys(all).length === 0) setConfirming(true)
  }

  return (
    <Modal
      open
      size="lg"
      title={confirming ? 'Confirmar ingreso' : 'Ingreso de mercadería'}
      onClose={onClose}
      busy={mutation.isPending}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={mutation.isPending}>
              Volver
            </Button>
            <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Registrar ingreso
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
        <dl className={styles.summary}>
          <dt>Producto</dt>
          <dd>
            {product.name} <span className={styles.muted}>(SKU {product.sku})</span>
          </dd>
          <dt>Cantidad</dt>
          <dd>
            {formatQuantity(units, product.sale_unit)}
            {values.mode === 'boxes' && (
              <span className={styles.muted}>
                {' '}
                ({values.quantity} cajas de {product.units_per_box})
              </span>
            )}
          </dd>
          <dt>Fecha de ingreso</dt>
          <dd>{formatDate(values.received_on)}</dd>
          <dt>Vencimiento</dt>
          <dd>{formatDate(values.expires_on)}</dd>
          <dt>Lote</dt>
          <dd>{optional(values.batch_number) ?? 'Sin número'}</dd>
          {optional(values.notes) && (
            <>
              <dt>Observaciones</dt>
              <dd>{values.notes}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className={styles.form}>
          <FormField label="Producto" htmlFor="receive-product" required error={errors.product}>
            <ProductPicker id="receive-product" value={product} onChange={setProduct} error={errors.product} />
          </FormField>

          <div className={styles.grid}>
            <FormField
              label={values.mode === 'boxes' ? 'Cantidad de cajas' : `Cantidad (${product ? SALE_UNIT_LABEL[product.sale_unit].toLowerCase() : 'unidades'})`}
              htmlFor="receive-quantity"
              required
              error={errors.quantity}
              hint={
                product && values.mode === 'boxes' && units > 0
                  ? `= ${formatQuantity(units, product.sale_unit)} (cajas de ${product.units_per_box})`
                  : undefined
              }
            >
              <input
                id="receive-quantity"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={errors.quantity ? true : undefined}
                value={values.quantity}
                onChange={(e) => set('quantity', e.target.value)}
              />
            </FormField>
            <fieldset className={styles.modes}>
              <legend>Cargar en</legend>
              <label>
                <input type="radio" name="receive-mode" checked={values.mode === 'units'} onChange={() => set('mode', 'units')} />
                Unidades
              </label>
              <label>
                <input type="radio" name="receive-mode" checked={values.mode === 'boxes'} onChange={() => set('mode', 'boxes')} />
                Cajas
              </label>
            </fieldset>
            <FormField label="Fecha de ingreso" htmlFor="receive-received_on" required error={errors.received_on}>
              <input
                id="receive-received_on"
                type="date"
                className="input"
                max={today}
                value={values.received_on}
                onChange={(e) => set('received_on', e.target.value)}
              />
            </FormField>
            <FormField label="Vencimiento" htmlFor="receive-expires_on" required error={errors.expires_on}>
              <input
                id="receive-expires_on"
                type="date"
                className="input"
                value={values.expires_on}
                onChange={(e) => set('expires_on', e.target.value)}
              />
            </FormField>
            <FormField label="Número de lote" htmlFor="receive-batch_number" error={errors.batch_number}>
              <input
                id="receive-batch_number"
                className="input"
                autoComplete="off"
                value={values.batch_number}
                onChange={(e) => set('batch_number', e.target.value)}
              />
            </FormField>
            <FormField
              label="Observaciones"
              htmlFor="receive-notes"
              error={errors.notes}
              hint="Por ejemplo, el número de factura o remito."
            >
              <input
                id="receive-notes"
                className="input"
                autoComplete="off"
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </FormField>
          </div>
        </div>
      )}
    </Modal>
  )
}
