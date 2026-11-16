import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { describedBy } from '../../components/ui/form-field-ids'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/PageHeader'
import { Pagination } from '../../components/ui/Pagination'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { countLabel, formatMoney, formatNumber } from '../../lib/format'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useSupabase } from '../../lib/supabase-context'
import { listCatalog } from '../catalogs/api'
import type { ProductOption } from '../movements/movements-api'
import { ProductPicker } from '../movements/ProductPicker'
import {
  applyPriceIncrease,
  BULK_CHANGES_KEY,
  DEFAULT_ROUNDING,
  hasFilters,
  isNotEnabled,
  listBulkChanges,
  parsePercent,
  PREVIEW_PAGE_SIZE,
  previewPriceIncrease,
  revertPriceChange,
  ROUNDING_OPTIONS,
  type BulkChange,
  type PreviewRow,
  type PriceFilters,
} from './prices-api'
import styles from './Prices.module.css'

/** Parámetros con los que se pidió la vista previa: se aplica exactamente eso. */
interface Plan {
  filters: PriceFilters
  percent: number
  rounding: number | null
  /** Para mostrar en la confirmación. */
  label: string
}

const NOT_ENABLED = 'Los aumentos masivos todavía no están habilitados en la base.'

/** Aumentos masivos de precios de góndola (contrato §19), con vista previa y deshacer. */
export function PricesPage() {
  const client = useSupabase()
  const brands = useQuery({ queryKey: ['catalog', 'brands'], queryFn: () => listCatalog(client, 'brands') })
  const categories = useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => listCatalog(client, 'categories') })
  const suppliers = useQuery({ queryKey: ['catalog', 'suppliers'], queryFn: () => listCatalog(client, 'suppliers') })

  const [brandId, setBrandId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [products, setProducts] = useState<ProductOption[]>([])
  const [percentText, setPercentText] = useState('')
  const [rounding, setRounding] = useState<string>(DEFAULT_ROUNDING)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ percent?: string; filters?: string }>({})
  const [plan, setPlan] = useState<Plan | null>(null)

  // Cualquier cambio en el formulario invalida la vista previa: se aplica solo lo que se vio.
  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setPlan(null)
  }

  const nameOf = (rows: { id: string; name: string }[] | undefined, id: string) => rows?.find((r) => r.id === id)?.name

  function showPreview() {
    const filters: PriceFilters = {
      brandIds: brandId ? [brandId] : [],
      categoryIds: categoryId ? [categoryId] : [],
      supplierIds: supplierId ? [supplierId] : [],
      productIds: products.map((p) => p.id),
    }
    const percent = parsePercent(percentText)
    const next = {
      percent: percent.error ?? undefined,
      filters: hasFilters(filters) ? undefined : 'Elegí al menos una marca, categoría, proveedor o producto.',
    }
    setErrors(next)
    if (percent.value === null || next.filters) return
    const parts = [
      nameOf(brands.data, brandId) && `marca ${nameOf(brands.data, brandId)}`,
      nameOf(categories.data, categoryId) && `categoría ${nameOf(categories.data, categoryId)}`,
      nameOf(suppliers.data, supplierId) && `proveedor ${nameOf(suppliers.data, supplierId)}`,
      products.length > 0 && countLabel(products.length, 'producto elegido', 'productos elegidos'),
    ].filter(Boolean)
    setPlan({
      filters,
      percent: percent.value,
      rounding: rounding === '' ? null : Number(rounding),
      label: `${percent.value > 0 ? '+' : ''}${formatNumber(percent.value)} % · ${parts.join(' y ')}`,
    })
  }

  const catalogSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    rows: { id: string; name: string; is_active: boolean }[] | undefined,
    all: string,
  ) => (
    <FormField label={label} htmlFor={id}>
      <select id={id} className="select" value={value} onChange={(e) => edit(onChange)(e.target.value)}>
        <option value="">{all}</option>
        {(rows ?? [])
          .filter((r) => r.is_active)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </select>
    </FormField>
  )

  return (
    <>
      <PageHeader
        title="Aumentos de precio"
        description="Subí o bajá el precio de góndola de muchos productos a la vez, con vista previa. Los costos no cambian."
      />

      <section className={styles.card} aria-labelledby="increase-title">
        <h2 id="increase-title" className={styles.title}>
          Nuevo aumento
        </h2>
        <p className={styles.help}>
          Los filtros se combinan: por ejemplo, marca Arcor <strong>y</strong> categoría Golosinas. Solo productos activos.
        </p>
        <div className={styles.grid}>
          {catalogSelect('price-brand', 'Marca', brandId, setBrandId, brands.data, 'Todas las marcas')}
          {catalogSelect('price-category', 'Categoría', categoryId, setCategoryId, categories.data, 'Todas las categorías')}
          {catalogSelect('price-supplier', 'Proveedor', supplierId, setSupplierId, suppliers.data, 'Todos los proveedores')}
        </div>

        <div className={styles.products}>
          <FormField label="Productos" htmlFor="price-product" hint="Opcional: agregá productos uno por uno (también con el lector).">
            <ProductPicker
              id="price-product"
              value={null}
              onChange={(p) => {
                if (p && !products.some((x) => x.id === p.id)) edit(setProducts)([...products, p])
              }}
            />
          </FormField>
          {products.length > 0 && (
            <ul className={styles.chips} aria-label="Productos elegidos">
              {products.map((p) => (
                <li key={p.id} className={styles.chip}>
                  {p.name}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Quitar ${p.name}`}
                    onClick={() => edit(setProducts)(products.filter((x) => x.id !== p.id))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {errors.filters && (
          <p className={styles.error} role="alert">
            {errors.filters}
          </p>
        )}

        <div className={styles.grid}>
          <FormField
            label="Porcentaje"
            htmlFor="price-percent"
            required
            hint="Sobre el precio de góndola. Negativo para bajar. Máximo 50 %."
            error={errors.percent}
          >
            <input
              id="price-percent"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={errors.percent ? true : undefined}
              aria-describedby={describedBy('price-percent', {
                hint: 'Sobre el precio de góndola. Negativo para bajar. Máximo 50 %.',
                error: errors.percent,
              })}
              value={percentText}
              onChange={(e) => edit(setPercentText)(e.target.value)}
            />
          </FormField>
          <FormField label="Redondear el precio final" htmlFor="price-rounding" hint="Desde la mitad sube.">
            <select
              id="price-rounding"
              className="select"
              value={rounding}
              onChange={(e) => edit(setRounding)(e.target.value)}
            >
              {ROUNDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Nota" htmlFor="price-notes" hint="Por ejemplo: lista de Arcor de noviembre.">
            <input
              id="price-notes"
              className="input"
              autoComplete="off"
              maxLength={200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
        </div>
        <div>
          <Button variant="primary" onClick={showPreview}>
            Ver vista previa
          </Button>
        </div>
      </section>

      {plan && <PreviewSection key={JSON.stringify(plan)} plan={plan} notes={notes} onApplied={() => setPlan(null)} />}

      <BulkChangesSection />
    </>
  )
}

function PreviewSection({ plan, notes, onApplied }: { plan: Plan; notes: string; onApplied: () => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  // Una clave por vista previa: si se reintenta (red), la base no aplica dos veces.
  const [idempotencyKey] = useState(newIdempotencyKey)

  const preview = useQuery({
    queryKey: ['price-preview', plan, page],
    queryFn: () => previewPriceIncrease(client, plan.filters, plan.percent, plan.rounding, page - 1),
    placeholderData: keepPreviousData,
  })

  const apply = useMutation({
    mutationFn: () =>
      applyPriceIncrease(client, {
        idempotencyKey,
        filters: plan.filters,
        percent: plan.percent,
        rounding: plan.rounding,
        excludedIds: [...excluded],
        notes,
      }),
    onSuccess: async (change) => {
      setConfirming(false)
      await Promise.all(
        [BULK_CHANGES_KEY, ['products'], ['product'], ['sellable'], ['dashboard']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
      toast.success(`Listo: cambió el precio de ${countLabel(change.products_count, 'producto', 'productos')}.`)
      onApplied()
    },
    onError: (e) => {
      setConfirming(false)
      toast.error(toAppError(e).message)
    },
  })

  const total = preview.data?.total ?? 0
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const columns: Column<PreviewRow, string>[] = [
    {
      key: 'include',
      header: 'Incluir',
      align: 'center',
      render: (r) => (
        <input
          type="checkbox"
          checked={!excluded.has(r.product_id)}
          disabled={r.change_amount === 0}
          aria-label={`Incluir ${r.name}`}
          onChange={() => toggle(r.product_id)}
        />
      ),
    },
    { key: 'sku', header: 'SKU', render: (r) => r.sku },
    {
      key: 'name',
      header: 'Producto',
      minWidth: '14rem',
      render: (r) => (
        <span className={styles.productCell}>
          {r.name}
          <span className={styles.muted}>
            {r.brand_name} · {r.category_name}
          </span>
        </span>
      ),
    },
    { key: 'old', header: 'Precio actual', align: 'end', render: (r) => formatMoney(r.old_price_with_vat) },
    {
      key: 'new',
      header: 'Precio nuevo',
      align: 'end',
      render: (r) => (r.change_amount === 0 ? <span className={styles.muted}>Sin cambio</span> : <strong>{formatMoney(r.new_price_with_vat)}</strong>),
    },
    {
      key: 'diff',
      header: 'Diferencia',
      align: 'end',
      render: (r) =>
        r.change_amount === 0 ? '—' : `${r.change_amount > 0 ? '+' : '−'}${formatMoney(Math.abs(r.change_amount))}`,
    },
  ]

  if (preview.error && isNotEnabled(preview.error)) {
    return (
      <section className={styles.card}>
        <p className={styles.muted}>{NOT_ENABLED}</p>
      </section>
    )
  }

  return (
    <section className={styles.card} aria-labelledby="preview-title">
      <div className={styles.header}>
        <div>
          <h2 id="preview-title" className={styles.title}>
            Vista previa
          </h2>
          <p className={styles.help}>
            {plan.label}. {preview.data ? countLabel(total, 'producto', 'productos') : ''}
            {excluded.size > 0 ? `, ${countLabel(excluded.size, 'excluido', 'excluidos')}` : ''}. Los que quedan igual
            después del redondeo no se tocan.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!preview.data || total === 0 || preview.isFetching}
          onClick={() => setConfirming(true)}
        >
          Aplicar aumento
        </Button>
      </div>

      {preview.isPending ? (
        <LoadingState label="Calculando precios…" />
      ) : preview.error ? (
        <ErrorState message={toAppError(preview.error).message} onRetry={() => void preview.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Precios antes y después del aumento"
            columns={columns}
            rows={preview.data.rows}
            rowKey={(r) => r.product_id}
            emptyTitle="Ningún producto activo cumple esos filtros"
          />
          {total > PREVIEW_PAGE_SIZE && (
            <Pagination page={page} pageSize={PREVIEW_PAGE_SIZE} total={total} onPageChange={setPage} disabled={preview.isFetching} />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title="Aplicar aumento de precios"
        confirmLabel="Aplicar"
        busy={apply.isPending}
        onConfirm={() => apply.mutate()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {plan.label}: cambia el precio de góndola de hasta{' '}
          <strong>{countLabel(total - excluded.size, 'producto', 'productos')}</strong>. Rige para las ventas nuevas
          desde ahora. Se puede deshacer desde «Últimos aumentos».
        </p>
      </ConfirmDialog>
    </section>
  )
}

function BulkChangesSection() {
  const client = useSupabase()
  const changes = useQuery({ queryKey: BULK_CHANGES_KEY, queryFn: () => listBulkChanges(client) })
  const [reverting, setReverting] = useState<BulkChange | null>(null)

  if (changes.error && isNotEnabled(changes.error)) return null

  const columns: Column<BulkChange, string>[] = [
    { key: 'date', header: 'Fecha', render: (c) => formatDateTime(c.created_at) },
    {
      key: 'percent',
      header: 'Porcentaje',
      align: 'end',
      render: (c) => `${c.percent > 0 ? '+' : ''}${formatNumber(c.percent)} %`,
    },
    { key: 'rounding', header: 'Redondeo', render: (c) => (c.rounding_multiple ? `A ${formatMoney(c.rounding_multiple)}` : 'Sin redondeo') },
    { key: 'count', header: 'Productos', align: 'end', render: (c) => formatNumber(c.products_count) },
    { key: 'notes', header: 'Nota', render: (c) => c.notes ?? '—' },
    {
      key: 'status',
      header: 'Estado',
      render: (c) =>
        c.status === 'reverted' ? (
          <span className={styles.muted}>Deshecho{c.revert_reason ? `: ${c.revert_reason}` : ''}</span>
        ) : (
          'Aplicado'
        ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (c) =>
        c.status === 'applied' ? (
          <Button size="sm" onClick={() => setReverting(c)} aria-label={`Deshacer el aumento del ${formatDateTime(c.created_at)}`}>
            Deshacer…
          </Button>
        ) : null,
    },
  ]

  return (
    <section className={styles.card} aria-labelledby="changes-title">
      <h2 id="changes-title" className={styles.title}>
        Últimos aumentos
      </h2>
      <DataTable
        caption="Últimos aumentos de precio"
        columns={columns}
        rows={changes.data ?? []}
        rowKey={(c) => c.id}
        isLoading={changes.isPending}
        errorMessage={changes.error ? toAppError(changes.error).message : null}
        onRetry={() => void changes.refetch()}
        emptyTitle="Todavía no hubo aumentos masivos"
      />
      {reverting && <RevertDialog key={reverting.id} change={reverting} onClose={() => setReverting(null)} />}
    </section>
  )
}

function RevertDialog({ change, onClose }: { change: BulkChange; onClose: () => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(newIdempotencyKey)

  const revert = useMutation({
    mutationFn: () => revertPriceChange(client, idempotencyKey, change.id, reason),
    onSuccess: async (result) => {
      await Promise.all(
        [BULK_CHANGES_KEY, ['products'], ['product'], ['sellable'], ['dashboard']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
      const skipped = result.skipped_product_ids.length
      toast.success(
        `Se restauró el precio de ${countLabel(result.restored, 'producto', 'productos')}.` +
          (skipped > 0
            ? ` ${countLabel(skipped, 'producto quedó', 'productos quedaron')} como estaba porque su precio cambió después.`
            : ''),
      )
      onClose()
    },
    onError: (e) => setError(toAppError(e).message),
  })

  function submit() {
    if (reason.trim() === '') {
      setError('Indicá por qué se deshace.')
      return
    }
    setError(null)
    revert.mutate()
  }

  return (
    <Modal
      open
      title="Deshacer aumento"
      onClose={onClose}
      busy={revert.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={revert.isPending}>
            Cancelar
          </Button>
          <Button variant="danger" loading={revert.isPending} onClick={submit}>
            Deshacer aumento
          </Button>
        </>
      }
    >
      <p>
        Vuelve al precio anterior a los {countLabel(change.products_count, 'producto', 'productos')} del aumento del{' '}
        {formatDateTime(change.created_at)}. Si alguno cambió de precio después, se deja como está.
      </p>
      <FormField label="Motivo" htmlFor="revert-reason" required error={error}>
        <input
          id="revert-reason"
          className="input"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy('revert-reason', { error })}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
    </Modal>
  )
}
