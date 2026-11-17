import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Modal } from '../../components/ui/Modal'
import type { ScaleLabel } from '../../domain/barcode'
import { toAppError } from '../../lib/errors'
import { formatMoney, formatNumber } from '../../lib/format'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { catalogTotal, manualDifference, parseAmount, type CartProduct } from './cart'
import { fetchWeighedProducts } from './pos-api'
import styles from './Pos.module.css'

export interface ScaleItem {
  product: CartProduct
  quantity: number
  total: number
  barcode: string | null
}

interface Props {
  /** Etiqueta escaneada; null = carga a mano (peso escrito, P-57). */
  label: ScaleLabel | null
  /** Aviso si esa misma etiqueta ya está en el carrito (P-58). */
  repeated: boolean
  onCancel: () => void
  onAdd: (item: ScaleItem) => void
}

/**
 * Fiambre o producto pesado (§20): el peso sale de la etiqueta (o se escribe), el
 * cajero elige el producto por kilo y escribe el importe de la etiqueta.
 */
export function ScaleItemDialog({ label, repeated, onCancel, onAdd }: Props) {
  const client = useSupabase()
  const products = useQuery({ queryKey: ['weighed-products'], queryFn: () => fetchWeighedProducts(client), staleTime: 300_000 })
  const [search, setSearch] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const [weightText, setWeightText] = useState(label ? String(label.weightKg).replace('.', ',') : '')
  const [amountText, setAmountText] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const term = search.trim().toLowerCase()
  const options = (products.data ?? []).filter((p) => term === '' || p.name.toLowerCase().includes(term) || p.sku.includes(term))
  const product = products.data?.find((p) => p.id === productId) ?? null

  const weight = label ? label.weightKg : parseDecimalInput(weightText.trim())
  const weightError =
    weight === null || !(weight > 0)
      ? 'Escribí el peso en kilos, por ejemplo 0,245.'
      : Math.round(weight * 1000) / 1000 !== weight
        ? 'Como máximo 3 decimales (gramos).'
        : null
  const amount = parseAmount(amountText)
  const catalog = product && weight && !weightError ? catalogTotal(product, weight) : null
  const diff = catalog !== null && amount.value !== null ? manualDifference(amount.value, catalog) : null

  function confirm() {
    setShowErrors(true)
    if (!product || weightError || amount.value === null || weight === null) return
    onAdd({ product, quantity: weight, total: amount.value, barcode: label?.code ?? null })
  }

  return (
    <Modal
      open
      size="md"
      title="Producto de balanza"
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
        {label ? (
          <p className={styles.scaleInfo}>
            Etiqueta de balanza: <strong>{formatNumber(label.weightKg)} kg</strong>
            <span className={styles.muted}> · PLU {label.plu}</span>
          </p>
        ) : (
          <FormField label="Peso (kg)" htmlFor="scale-weight" required error={showErrors ? (weightError ?? undefined) : undefined}>
            <input
              id="scale-weight"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={weightText}
              onChange={(e) => setWeightText(e.target.value)}
            />
          </FormField>
        )}
        {repeated && (
          <p className={styles.scanError} role="alert">
            Esta etiqueta ya está en el carrito. Si es otro paquete con el mismo peso, seguí; si no, cancelá.
          </p>
        )}

        <FormField
          label="Producto"
          htmlFor="scale-search"
          required
          hint="Solo productos que se venden por kilo."
          error={showErrors && !product ? 'Elegí qué producto es.' : undefined}
        >
          <input
            id="scale-search"
            type="search"
            className="input"
            autoComplete="off"
            placeholder="Buscá por nombre"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </FormField>
        <ul className={styles.scaleOptions} aria-label="Productos por kilo">
          {products.isPending && <li className={styles.muted}>Cargando…</li>}
          {products.error && <li className={styles.scanError}>{toAppError(products.error).message}</li>}
          {products.data && options.length === 0 && (
            <li className={styles.muted}>No hay productos por kilo con ese nombre. Si no está cargado, usá «Producto sin cargar».</li>
          )}
          {options.slice(0, 50).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`${styles.result} ${p.id === productId ? styles.resultSelected : ''}`}
                aria-pressed={p.id === productId}
                onClick={() => setProductId(p.id)}
              >
                <span>{p.name}</span>
                <span className={styles.muted}>{formatMoney(p.sale_price_with_vat)} / kg</span>
              </button>
            </li>
          ))}
        </ul>

        <FormField
          label="Importe de la etiqueta"
          htmlFor="scale-amount"
          required
          hint="El importe impreso en la etiqueta, con IVA."
          error={showErrors ? (amount.error ?? undefined) : undefined}
        >
          <input
            id="scale-amount"
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
        {catalog !== null && (
          <p className={diff?.warn ? styles.scanError : styles.muted} role={diff?.warn ? 'alert' : undefined}>
            Con el precio de Zahuy serían {formatMoney(catalog)}.
            {diff?.warn &&
              ` El importe difiere ${formatNumber(Math.round(Math.abs(diff.ratio) * 100))} %: revisá la etiqueta o el precio por kilo. Se puede cobrar igual.`}
          </p>
        )}
      </div>
    </Modal>
  )
}
