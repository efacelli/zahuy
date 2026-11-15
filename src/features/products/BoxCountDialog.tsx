import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { formatQuantity, type SaleUnit } from '../../domain/units'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { updateBoxCount } from './api'
import styles from './ProductForm.module.css'

interface BoxCountDialogProps {
  product: { id: string; name: string; boxes_quantity: number; units_per_box: number; stock_quantity: number; sale_unit: SaleUnit } | null
  onClose: () => void
}

/** Conteo manual de cajas cerradas en depósito (contrato v0.4.0 §5.5, respuesta 7 y 8). */
export function BoxCountDialog({ product, onClose }: BoxCountDialogProps) {
  if (!product) return null
  return <BoxCountContent key={product.id} product={product} onClose={onClose} />
}

function BoxCountContent({ product, onClose }: { product: NonNullable<BoxCountDialogProps['product']>; onClose: () => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [value, setValue] = useState(String(product.boxes_quantity))
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const boxes = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null
  const inBoxes = boxes === null ? null : boxes * product.units_per_box

  const mutation = useMutation({
    mutationFn: (n: number) => updateBoxCount(client, product.id, n),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Cajas de "${product.name}" actualizadas.`)
      onClose()
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function save() {
    setServerError(null)
    if (boxes === null) {
      setError('Ingresá un número entero de cajas (0 o más).')
      return
    }
    setError(null)
    mutation.mutate(boxes)
  }

  return (
    <Modal
      open
      size="sm"
      title="Actualizar cajas en depósito"
      onClose={onClose}
      busy={mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      <p className={styles.groupHelp}>
        <strong>{product.name}</strong>: contá las cajas cerradas que hay en el depósito. No cambia el stock; solo indica
        cuántas de esas unidades están en cajas.
      </p>
      <FormField
        label="Cajas cerradas"
        htmlFor="boxes-count"
        required
        error={error}
        hint={
          inBoxes === null
            ? undefined
            : `= ${formatQuantity(inBoxes, product.sale_unit)} en cajas de ${product.units_per_box} (stock total ${formatQuantity(product.stock_quantity, product.sale_unit)})`
        }
      >
        <input
          id="boxes-count"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !mutation.isPending) {
              e.preventDefault()
              save()
            }
          }}
        />
      </FormField>
      {inBoxes !== null && inBoxes > product.stock_quantity && (
        <p className={styles.warningText} role="status">
          Las cajas superan el stock registrado: revisá el conteo o registrá el ingreso que falta.
        </p>
      )}
    </Modal>
  )
}
