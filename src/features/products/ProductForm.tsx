import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FormField } from '../../components/ui/FormField'
import { describedBy } from '../../components/ui/form-field-ids'
import { Icon } from '../../components/ui/Icon'
import { barcodeWarning } from '../../domain/barcode'
import { SALE_UNIT_LABEL, SALE_UNITS, formatQuantity, isIntegerUnit } from '../../domain/units'
import { VAT_RATES, formatVatRate, priceWithVatPreview } from '../../domain/vat'
import { formatDate, todayInAppTimeZone } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { newIdempotencyKey } from '../../lib/idempotency'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import {
  createProduct,
  productErrorMessage,
  toCreateProductParams,
  toUpdateProductPayload,
  updateProduct,
  type CreatedProduct,
} from './api'
import { CatalogSelect } from './CatalogSelect'
import {
  emptyProductForm,
  productFormSchema,
  productFormWarnings,
  type ProductFormOutput,
  type ProductFormValues,
} from './product-form-schema'
import styles from './ProductForm.module.css'

/** Producto a editar: su id, su SKU (solo lectura) y los valores actuales. */
export interface EditingProduct {
  id: string
  sku: string
  values: ProductFormValues
}

interface ProductFormProps {
  onCancel: () => void
  /** Alta: se llama con el producto creado (trae el SKU asignado por la base). */
  onCreated?: (product: CreatedProduct) => void
  /** Edición: si se indica, el formulario edita ese producto en lugar de crear uno. */
  editing?: EditingProduct
  onSaved?: (product: CreatedProduct) => void
  /** Alta: código de barras ya leído con el lector (llega desde `?codigo=`). */
  initialBarcode?: string
}

/**
 * Alta de producto con stock inicial opcional (contrato §8.4, `create_product`)
 * o edición de sus datos (UPDATE directo con RLS, §5.5). La edición nunca toca stock.
 */
export function ProductForm({ onCreated, onCancel, editing, onSaved, initialBarcode }: ProductFormProps) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const today = todayInAppTimeZone()
  const schema = useMemo(() => productFormSchema(today), [today])

  // Una clave por intento de alta; se conserva en los reintentos hasta que se crea el producto.
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [pending, setPending] = useState<ProductFormOutput | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ProductFormValues, unknown, ProductFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: editing?.values ?? { ...emptyProductForm(today), barcode: initialBarcode ?? '' },
    mode: 'onTouched',
  })

  const values = useWatch({ control }) as ProductFormValues
  const warnings = productFormWarnings(values, today)
  const unit = values.sale_unit ?? 'unit'
  const hasInitialStock = (values.initial_quantity ?? '').trim() !== ''
  const salePrice = parseDecimalInput(values.sale_price ?? '')
  const finalPricePreview = salePrice === null ? null : priceWithVatPreview(salePrice, Number(values.vat_rate))

  const mutation = useMutation({
    mutationFn: (output: ProductFormOutput) =>
      editing
        ? updateProduct(client, editing.id, toUpdateProductPayload(output))
        : createProduct(client, toCreateProductParams(output, idempotencyKey)),
    onSuccess: async (product) => {
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      if (editing) onSaved?.(product)
      else onCreated?.(product)
    },
    onError: (error) => {
      setPending(null)
      setServerError(productErrorMessage(error, Boolean(editing)))
    },
  })

  const onValid = (output: ProductFormOutput) => {
    setServerError(null)
    // Si afecta stock, se confirma antes (CLAUDE.md, UI).
    if (output.initial_stock) setPending(output)
    else mutation.mutate(output)
  }

  const err = (name: keyof ProductFormValues) => errors[name]?.message
  const field = (name: keyof ProductFormValues, hint?: string) => ({
    id: `product-${name}`,
    'aria-invalid': err(name) ? true : undefined,
    'aria-describedby': describedBy(`product-${name}`, { hint, error: err(name) }),
  })

  return (
    <form className={styles.form} onSubmit={handleSubmit(onValid)} noValidate>
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}

      <fieldset className={styles.group}>
        <legend>Identificación</legend>
        <p className={styles.groupHelp}>
          {editing ? (
            <>
              SKU <strong>{editing.sku}</strong> (lo asignó el sistema; no se cambia).
            </>
          ) : (
            'El código interno (SKU) lo asigna el sistema al guardar.'
          )}
        </p>
        <div className={styles.grid}>
          <FormField
            label="Código de barras"
            htmlFor="product-barcode"
            error={err('barcode')}
            hint={barcodeWarning(values.barcode ?? '') ?? '8 a 14 números (EAN/UPC). Se puede escanear con el lector.'}
          >
            <input
              className="input"
              inputMode="numeric"
              autoComplete="off"
              {...field('barcode', '8 a 14 números (EAN/UPC).')}
              {...register('barcode')}
              onKeyDown={(e) => {
                // El lector termina con Enter: pasar al nombre en lugar de enviar el formulario.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  document.getElementById('product-name')?.focus()
                }
              }}
            />
          </FormField>
          <div className={styles.wide}>
            <FormField label="Nombre" htmlFor="product-name" required error={err('name')}>
              <input className="input" autoComplete="off" {...field('name')} {...register('name')} />
            </FormField>
          </div>
          <div className={styles.wide}>
            <FormField label="Descripción" htmlFor="product-description" error={err('description')}>
              <textarea className="textarea" rows={2} {...field('description')} {...register('description')} />
            </FormField>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Clasificación</legend>
        <div className={styles.grid}>
          <CatalogSelect
            id="product-category_id"
            label="Categoría"
            table="categories"
            required
            placeholder="Elegí una categoría"
            error={err('category_id')}
            registration={register('category_id')}
          />
          <CatalogSelect
            id="product-brand_id"
            label="Marca"
            table="brands"
            required
            placeholder="Elegí una marca"
            error={err('brand_id')}
            registration={register('brand_id')}
          />
          <CatalogSelect
            id="product-supplier_id"
            label="Proveedor"
            table="suppliers"
            required={false}
            placeholder="Sin proveedor"
            error={err('supplier_id')}
            registration={register('supplier_id')}
          />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Venta y precios</legend>
        <div className={styles.grid}>
          <FormField label="Unidad de venta" htmlFor="product-sale_unit" required error={err('sale_unit')}>
            <select className="select" {...field('sale_unit')} {...register('sale_unit')}>
              {SALE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {SALE_UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="IVA" htmlFor="product-vat_rate" required error={err('vat_rate')}>
            <select className="select" {...field('vat_rate')} {...register('vat_rate')}>
              {VAT_RATES.map((r) => (
                <option key={r} value={String(r)}>
                  {formatVatRate(r)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Precio de costo (sin IVA)" htmlFor="product-cost_price" required error={err('cost_price')}>
            <input className="input" inputMode="decimal" autoComplete="off" placeholder="0,00" {...field('cost_price')} {...register('cost_price')} />
          </FormField>
          <FormField label="Precio de venta (sin IVA)" htmlFor="product-sale_price" required error={err('sale_price')}>
            <input className="input" inputMode="decimal" autoComplete="off" placeholder="0,00" {...field('sale_price')} {...register('sale_price')} />
          </FormField>
          <div className={styles.finalPrice} aria-live="polite">
            <span>Precio final en góndola (con IVA)</span>
            <strong>{finalPricePreview === null ? '—' : formatMoney(finalPricePreview)}</strong>
            <small>Vista previa; el valor oficial lo calcula el sistema al guardar.</small>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Stock y estado</legend>
        <div className={styles.grid}>
          <FormField
            label="Stock mínimo"
            htmlFor="product-min_stock"
            error={err('min_stock')}
            hint="Con este número o menos se marca como stock bajo."
          >
            <input className="input" inputMode="decimal" autoComplete="off" {...field('min_stock', 'Con este número o menos se marca como stock bajo.')} {...register('min_stock')} />
          </FormField>
          <FormField
            label="Cantidad de cajas"
            htmlFor="product-boxes_quantity"
            error={err('boxes_quantity')}
            hint="Cajas cerradas en depósito, contadas a mano."
          >
            <input className="input" inputMode="numeric" autoComplete="off" {...field('boxes_quantity', 'Cajas cerradas en depósito, contadas a mano.')} {...register('boxes_quantity')} />
          </FormField>
          <FormField
            label="Unidades por caja"
            htmlFor="product-units_per_box"
            required
            error={err('units_per_box')}
            hint="12 por defecto. Sirve para mostrar el stock como sueltas + cajas."
          >
            <input
              className="input"
              inputMode="numeric"
              autoComplete="off"
              {...field('units_per_box', '12 por defecto. Sirve para mostrar el stock como sueltas + cajas.')}
              {...register('units_per_box')}
            />
          </FormField>
          <div className={styles.checkboxField}>
            <input type="checkbox" id="product-is_active" {...register('is_active')} />
            <label htmlFor="product-is_active">Producto activo</label>
          </div>
        </div>
      </fieldset>

      {!editing && (
      <fieldset className={styles.group}>
        <legend>Stock inicial (opcional)</legend>
        <p className={styles.groupHelp}>
          Si ya hay mercadería, cargala acá: se crea el primer lote y queda registrado el ingreso. Si no, dejá la
          cantidad vacía y cargá el stock después desde Movimientos.
        </p>
        <div className={styles.grid}>
          <FormField
            label={`Cantidad (${SALE_UNIT_LABEL[unit].toLowerCase()})`}
            htmlFor="product-initial_quantity"
            error={err('initial_quantity')}
            hint={isIntegerUnit(unit) ? 'Número entero.' : 'Hasta 3 decimales.'}
          >
            <input className="input" inputMode="decimal" autoComplete="off" {...field('initial_quantity', isIntegerUnit(unit) ? 'Número entero.' : 'Hasta 3 decimales.')} {...register('initial_quantity')} />
          </FormField>
          <FormField label="Fecha de ingreso" htmlFor="product-received_on" required={hasInitialStock} error={err('received_on')}>
            <input type="date" className="input" max={today} {...field('received_on')} {...register('received_on')} />
          </FormField>
          <FormField
            label="Vencimiento"
            htmlFor="product-expires_on"
            required={hasInitialStock}
            error={err('expires_on')}
            hint="Obligatorio si cargás stock: todos los productos se controlan por vencimiento."
          >
            <input
              type="date"
              className="input"
              {...field('expires_on', 'Obligatorio si cargás stock: todos los productos se controlan por vencimiento.')}
              {...register('expires_on')}
            />
          </FormField>
          <FormField label="Número de lote" htmlFor="product-batch_number" error={err('batch_number')}>
            <input className="input" autoComplete="off" {...field('batch_number')} {...register('batch_number')} />
          </FormField>
        </div>
      </fieldset>
      )}

      {warnings.length > 0 && (
        <ul className={styles.warnings} aria-label="Advertencias">
          {warnings.map((w) => (
            <li key={w}>
              <Badge tone="warning">Revisar</Badge> {w}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <Button onClick={onCancel} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending && !pending}>
          {editing ? 'Guardar cambios' : 'Guardar producto'}
        </Button>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Confirmar alta con stock"
        confirmLabel="Crear producto e ingresar stock"
        busy={mutation.isPending}
        onConfirm={() => pending && mutation.mutate(pending)}
        onCancel={() => setPending(null)}
      >
        {pending?.initial_stock && (
          <dl className={styles.summary}>
            <dt>Producto</dt>
            <dd>{pending.name}</dd>
            <dt>Ingreso</dt>
            <dd>{formatQuantity(pending.initial_stock.quantity, pending.sale_unit)}</dd>
            <dt>Fecha de ingreso</dt>
            <dd>{formatDate(pending.initial_stock.received_on)}</dd>
            <dt>Vencimiento</dt>
            <dd>{formatDate(pending.initial_stock.expires_on)}</dd>
            <dt>Precio sin IVA</dt>
            <dd>{formatMoney(pending.sale_price)}</dd>
            <dt>Precio final (estimado)</dt>
            <dd>{formatMoney(priceWithVatPreview(pending.sale_price, pending.vat_rate))}</dd>
          </dl>
        )}
      </ConfirmDialog>
    </form>
  )
}
