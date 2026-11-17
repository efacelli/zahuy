import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Modal } from '../../components/ui/Modal'
import { parseAmount, type FreeVatRate } from './cart'
import styles from './Pos.module.css'

export interface FreeItem {
  description: string
  vatRate: FreeVatRate
  quantity: number
  total: number
}

const MAX_DESCRIPTION = 80

/** Producto que no está cargado en Zahuy (§20.8): no descuenta stock. */
export function FreeItemDialog({ onCancel, onAdd }: { onCancel: () => void; onAdd: (item: FreeItem) => void }) {
  const [description, setDescription] = useState('')
  const [vatRate, setVatRate] = useState<FreeVatRate>(21)
  const [quantityText, setQuantityText] = useState('1')
  const [amountText, setAmountText] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const text = description.trim()
  const descriptionError = text === '' ? 'Escribí qué es (por ejemplo, «Pan casero»).' : null
  const quantity = /^\d+$/.test(quantityText.trim()) ? Number(quantityText) : null
  const quantityError = quantity === null || quantity < 1 ? 'Escribí una cantidad entera, 1 o más.' : null
  const amount = parseAmount(amountText)

  function confirm() {
    setShowErrors(true)
    if (descriptionError || quantityError || amount.value === null || quantity === null) return
    onAdd({ description: text, vatRate, quantity, total: amount.value })
  }

  return (
    <Modal
      open
      size="md"
      title="Producto sin cargar"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" onClick={confirm}>
            Agregar al carrito
          </Button>
        </>
      }
    >
      <div className={styles.dialogForm}>
        <p className={styles.muted}>
          Para cobrar algo que no está en Zahuy. No descuenta stock; el encargado lo ve después para darlo de alta.
        </p>
        <FormField label="Descripción" htmlFor="free-description" required error={showErrors ? (descriptionError ?? undefined) : undefined}>
          <input
            id="free-description"
            className="input"
            autoComplete="off"
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <div className={styles.dialogRow}>
          <FormField label="Cantidad" htmlFor="free-quantity" required error={showErrors ? (quantityError ?? undefined) : undefined}>
            <input
              id="free-quantity"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
            />
          </FormField>
          <FormField label="IVA" htmlFor="free-vat" required>
            <select
              id="free-vat"
              className="select"
              value={String(vatRate)}
              onChange={(e) => setVatRate(Number(e.target.value) as FreeVatRate)}
            >
              <option value="21">21 %</option>
              <option value="10.5">10,5 %</option>
            </select>
          </FormField>
        </div>
        <FormField
          label="Importe total"
          htmlFor="free-amount"
          required
          hint="Lo que se cobra por todas las unidades, con IVA."
          error={showErrors ? (amount.error ?? undefined) : undefined}
        >
          <input
            id="free-amount"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirm()
              }
            }}
          />
        </FormField>
      </div>
    </Modal>
  )
}
