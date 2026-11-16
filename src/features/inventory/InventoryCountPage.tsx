import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { useToast } from '../../components/ui/toast-context'
import { barcodeWarning, isBarcodeLike, normalizeBarcode } from '../../domain/barcode'
import { SALE_UNIT_LABEL, formatQuantity } from '../../domain/units'
import { formatDate, parseTypedDate, todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { enterMovesToNextField } from '../../lib/focus-next'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { emptyReceiveForm, receiveQuantity, validateReceive, type FieldErrors, type ReceiveFormValues } from '../movements/movement-forms'
import { receiveStock, type ProductOption } from '../movements/movements-api'
import { ProductPicker } from '../movements/ProductPicker'
import { useRefreshStock } from '../movements/useRefreshStock'
import { assignBarcode, fetchProductStock } from './inventory-api'
import styles from './InventoryCountPage.module.css'

const PRODUCT_FIELD = 'inv-product'
const QUANTITY_FIELD = 'inv-quantity'
const CONFIRM_BUTTON = 'inv-confirm'
/** Queda en las observaciones del lote para distinguir la carga inicial de un ingreso de compra. */
const NOTES = 'Carga de inventario'

interface LoadedLine {
  key: string
  name: string
  sku: string
  quantityText: string
  expiresOn: string
  barcode: string | null
}

const focusSoon = (id: string) => window.requestAnimationFrame(() => document.getElementById(id)?.focus())

/**
 * Carga rápida del inventario recorriendo las góndolas, con el lector USB:
 * escanear (o buscar) → cantidad → vencimiento → Enter → confirmar con Enter.
 * Cada producto es un lote nuevo con `receive_stock` (§8.1). Si el producto no
 * tiene código de barras, el encargado se lo guarda en el mismo paso.
 */
export function InventoryCountPage() {
  const client = useSupabase()
  const toast = useToast()
  const refresh = useRefreshStock()
  const canEditProducts = usePermissions().manageInventory
  const today = todayInAppTimeZone()

  const [product, setProduct] = useState<ProductOption | null>(null)
  const [values, setValues] = useState<ReceiveFormValues>(() => emptyReceiveForm(today))
  const [barcode, setBarcode] = useState('')
  const [expiryText, setExpiryText] = useState('')
  /** Código escaneado que ningún producto tiene: se ofrece para el próximo producto elegido. */
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<ReceiveFormValues> & { product?: string; barcode?: string }>({})
  const [confirming, setConfirming] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [lines, setLines] = useState<LoadedLine[]>([])
  /** Cambia en cada carga: el buscador vuelve vacío, listo para el próximo escaneo. */
  const [pickerKey, setPickerKey] = useState(0)
  const idempotencyKey = useRef(newIdempotencyKey())

  const stock = useQuery({
    queryKey: ['product-stock', product?.id],
    queryFn: () => fetchProductStock(client, product?.id ?? ''),
    enabled: product !== null,
  })

  const set = <K extends keyof ReceiveFormValues>(key: K, value: ReceiveFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const parsedExpiry = parseTypedDate(expiryText)
  const units = product ? receiveQuantity(values, product.units_per_box) : 0
  const canAssignBarcode = canEditProducts && product !== null && product.barcode === null
  const barcodeToSave = canAssignBarcode && barcode.trim() !== '' ? normalizeBarcode(barcode) : null

  function pickProduct(next: ProductOption | null) {
    setProduct(next)
    setErrors({})
    setServerError(null)
    setConfirming(false)
    setBarcode(next && next.barcode === null && pendingCode ? pendingCode : '')
    if (next === null) focusSoon(PRODUCT_FIELD)
  }

  function reset(keepExpiry: boolean) {
    setProduct(null)
    setValues((v) => ({ ...emptyReceiveForm(today), expires_on: keepExpiry ? v.expires_on : '' }))
    if (!keepExpiry) setExpiryText('')
    setBarcode('')
    setPendingCode(null)
    setErrors({})
    setConfirming(false)
    setServerError(null)
    idempotencyKey.current = newIdempotencyKey()
    setPickerKey((k) => k + 1)
    focusSoon(PRODUCT_FIELD)
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error('Sin producto')
      // Primero el código: si está repetido, no se carga stock a medias.
      if (barcodeToSave) await assignBarcode(client, product.id, barcodeToSave)
      await receiveStock(client, {
        p_idempotency_key: idempotencyKey.current,
        p_product_id: product.id,
        p_quantity: units,
        p_received_on: null,
        p_expires_on: values.expires_on,
        p_batch_number: null,
        p_notes: NOTES,
      })
    },
    onSuccess: async () => {
      if (!product) return
      const quantityText = formatQuantity(units, product.sale_unit)
      setLines((prev) => [
        {
          key: idempotencyKey.current,
          name: product.name,
          sku: product.sku,
          quantityText,
          expiresOn: values.expires_on,
          barcode: barcodeToSave,
        },
        ...prev,
      ])
      toast.success(`Cargado: ${quantityText} de "${product.name}".`)
      reset(false)
      await refresh()
    },
    onError: (error) => {
      // Reintentar usa la misma clave: la base no duplica el ingreso (§8.5).
      setConfirming(false)
      setServerError(toAppError(error).message)
    },
  })

  function review(event: React.FormEvent) {
    event.preventDefault()
    setServerError(null)
    const found: typeof errors = product ? validateReceive(values, product.sale_unit, today) : { product: 'Escaneá o buscá el producto.' }
    if (canAssignBarcode && barcode.trim() !== '' && !isBarcodeLike(barcode)) {
      found.barcode = 'El código de barras tiene que tener de 8 a 14 números.'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const first = found.product ? PRODUCT_FIELD : found.quantity ? QUANTITY_FIELD : found.expires_on ? 'inv-expires_on' : 'inv-barcode'
      focusSoon(first)
      return
    }
    setConfirming(true)
    focusSoon(CONFIRM_BUTTON)
  }

  const warning = barcodeToSave ? barcodeWarning(barcodeToSave) : null

  return (
    <>
      <PageHeader
        title="Carga de inventario"
        description="Recorré las góndolas con el lector: escaneá, poné la cantidad y el vencimiento, y Enter. Cada producto queda como un lote nuevo."
      />

      <div className={styles.layout}>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Enter pasa al siguiente campo (focus-next) */}
        <form className={styles.card} onSubmit={review} onKeyDown={enterMovesToNextField} noValidate aria-label="Cargar un producto">
          {serverError && (
            <p className={styles.serverError} role="alert">
              <Icon name="error" size={18} /> {serverError}
            </p>
          )}

          {pendingCode && !product && (
            <p className={styles.note} role="status">
              El código <strong>{pendingCode}</strong> no está cargado en ningún producto.{' '}
              {canEditProducts
                ? 'Buscá el producto por nombre y se lo guardamos.'
                : 'Buscá el producto por nombre; el encargado le puede guardar el código.'}{' '}
              <button type="button" className={styles.linkButton} onClick={() => setPendingCode(null)}>
                Descartar
              </button>
            </p>
          )}

          <FormField label="Producto" htmlFor={PRODUCT_FIELD} required error={errors.product}>
            <ProductPicker
              key={pickerKey}
              id={PRODUCT_FIELD}
              value={product}
              onChange={pickProduct}
              error={errors.product}
              nextFocusId={QUANTITY_FIELD}
              onUnknownBarcode={setPendingCode}
            />
          </FormField>

          {product && (
            <p className={styles.current}>
              Stock actual:{' '}
              <strong>{stock.data === undefined ? '…' : formatQuantity(stock.data, product.sale_unit)}</strong>
              {' · '}
              {product.barcode ? `Código ${product.barcode}` : 'Sin código de barras'}
              {product.units_per_box > 1 && ` · Caja de ${product.units_per_box}`}
            </p>
          )}

          {product && !confirming && (
            <div className={styles.grid}>
              <FormField
                label={values.mode === 'boxes' ? 'Cantidad de cajas' : `Cantidad (${SALE_UNIT_LABEL[product.sale_unit].toLowerCase()})`}
                htmlFor={QUANTITY_FIELD}
                required
                error={errors.quantity}
                hint={
                  values.mode === 'boxes' && units > 0
                    ? `= ${formatQuantity(units, product.sale_unit)} (cajas de ${product.units_per_box})`
                    : undefined
                }
              >
                <input
                  id={QUANTITY_FIELD}
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={errors.quantity ? true : undefined}
                  value={values.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  onKeyDown={(e) => {
                    // Enter salta directo al vencimiento (unidades/cajas se cambia con el mouse o Tab).
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    document.getElementById('inv-expires_on')?.focus()
                  }}
                />
              </FormField>
              <fieldset className={styles.modes}>
                <legend>Cargar en</legend>
                <label>
                  <input type="radio" name="inv-mode" checked={values.mode === 'units'} onChange={() => set('mode', 'units')} />
                  Unidades
                </label>
                <label>
                  <input type="radio" name="inv-mode" checked={values.mode === 'boxes'} onChange={() => set('mode', 'boxes')} />
                  Cajas
                </label>
              </fieldset>
              <FormField
                label="Vencimiento"
                htmlFor="inv-expires_on"
                required
                error={errors.expires_on}
                hint={expiryText.trim() === '' ? 'Día, mes y año: 100327 o 10/03/2027.' : parsedExpiry ? `= ${formatDate(parsedExpiry)}` : 'Fecha no válida.'}
              >
                <input
                  id="inv-expires_on"
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="dd/mm/aaaa"
                  aria-invalid={errors.expires_on ? true : undefined}
                  value={expiryText}
                  onChange={(e) => {
                    setExpiryText(e.target.value)
                    // La base recibe ISO; si no se entiende, va el texto y la validación lo marca.
                    set('expires_on', parseTypedDate(e.target.value) ?? e.target.value.trim())
                  }}
                />
              </FormField>
              {canAssignBarcode && (
                <FormField
                  label="Código de barras"
                  htmlFor="inv-barcode"
                  error={errors.barcode ?? undefined}
                  hint={warning ?? 'Opcional: escanealo para que la próxima vez se encuentre solo.'}
                >
                  <input
                    id="inv-barcode"
                    className="input"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={errors.barcode ? true : undefined}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                  />
                </FormField>
              )}
            </div>
          )}

          {product && confirming && (
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
              <dt>Vencimiento</dt>
              <dd>{formatDate(values.expires_on)}</dd>
              {barcodeToSave && (
                <>
                  <dt>Código de barras</dt>
                  <dd>{barcodeToSave} (se guarda en el producto)</dd>
                </>
              )}
            </dl>
          )}

          <div className={styles.actions}>
            {product && (
              <Button onClick={() => (confirming ? setConfirming(false) : reset(false))} disabled={mutation.isPending}>
                {confirming ? 'Volver' : 'Cancelar'}
              </Button>
            )}
            {confirming ? (
              <Button id={CONFIRM_BUTTON} variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
                Confirmar ingreso
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={!product}>
                Revisar
              </Button>
            )}
          </div>
        </form>

        <section className={styles.card} aria-labelledby="inv-loaded-title">
          <h2 id="inv-loaded-title" className={styles.subtitle}>
            Cargados en esta sesión ({lines.length})
          </h2>
          {lines.length === 0 ? (
            <p className={styles.muted}>Todavía nada. Lo que cargues aparece acá; el historial completo está en Movimientos.</p>
          ) : (
            <ol className={styles.lines}>
              {lines.map((l) => (
                <li key={l.key}>
                  <span>
                    <strong>{l.name}</strong> <span className={styles.muted}>SKU {l.sku}</span>
                    {l.barcode && <span className={styles.muted}> · código {l.barcode} guardado</span>}
                  </span>
                  <span className={styles.nowrap}>
                    {l.quantityText} · vence {formatDate(l.expiresOn)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  )
}
