import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { FormField } from '../../components/ui/FormField'
import { PageHeader } from '../../components/ui/PageHeader'
import { useToast } from '../../components/ui/toast-context'
import { formatDate, formatDateTime, todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { countLabel, formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { listCatalog } from '../catalogs/api'
import { ProductPicker } from '../movements/ProductPicker'
import { BULK_CHANGES_KEY, listBulkChanges } from '../prices/prices-api'
import {
  LABEL_FORMATS,
  LABELS_PER_SHEET,
  MAX_COPIES,
  PRICE_UNIT_SUFFIX,
  expandLabels,
  fetchLabelProducts,
  fetchLabelProductsByCatalog,
  mergeItems,
  productIdsChangedSince,
  productIdsOfBulkChange,
  type LabelFormat,
  type LabelItem,
  type LabelProduct,
} from './labels-api'
import styles from './Labels.module.css'

const FORMAT_KEY = 'zahuy.etiquetas.formato'
const COPY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, MAX_COPIES]

function readFormat(): LabelFormat {
  try {
    const saved = localStorage.getItem(FORMAT_KEY)
    if (LABEL_FORMATS.some((f) => f.value === saved)) return saved as LabelFormat
  } catch {
    // Sin almacenamiento: se usa el formato por defecto.
  }
  return 'a4-24'
}

type ItemColumn = 'product' | 'price' | 'copies' | 'remove'

/** Etiquetas de precio para góndola: se arma una lista y se imprime en hojas A4 de etiquetas. */
export function LabelsPage() {
  const client = useSupabase()
  const permissions = usePermissions()
  const toast = useToast()
  const today = todayInAppTimeZone()

  const brands = useQuery({ queryKey: ['catalog', 'brands'], queryFn: () => listCatalog(client, 'brands') })
  const categories = useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => listCatalog(client, 'categories') })
  // El historial de precios solo lo leen encargado, dueño y programador (§19.2).
  const canUseHistory = permissions.manageInventory
  const bulkChanges = useQuery({
    queryKey: BULK_CHANGES_KEY,
    queryFn: () => listBulkChanges(client),
    enabled: canUseHistory,
  })

  const [items, setItems] = useState<LabelItem[]>([])
  const [format, setFormatState] = useState<LabelFormat>(readFormat)
  const [brandId, setBrandId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [bulkId, setBulkId] = useState('')
  const [since, setSince] = useState(today)

  function setFormat(value: LabelFormat) {
    setFormatState(value)
    try {
      localStorage.setItem(FORMAT_KEY, value)
    } catch {
      // Se usa igual; solo no se recuerda.
    }
  }

  const add = useMutation({
    mutationFn: (load: () => Promise<LabelProduct[]>) => load(),
    onSuccess: (products) => {
      if (products.length === 0) {
        toast.info('No hay productos activos para agregar con esa opción.')
        return
      }
      const { items: next, added } = mergeItems(items, products)
      setItems(next)
      if (added === 0) toast.info('Esos productos ya estaban en la lista.')
      else toast.success(`Se ${added === 1 ? 'agregó' : 'agregaron'} ${countLabel(added, 'producto', 'productos')}.`)
    },
    onError: (error) => toast.error(toAppError(error).message),
  })

  const fromIds = (loadIds: () => Promise<string[]>) => async () => fetchLabelProducts(client, await loadIds())

  const labels = expandLabels(items)
  const perSheet = LABELS_PER_SHEET[format]
  const sheets: LabelProduct[][] = []
  for (let i = 0; i < labels.length; i += perSheet) sheets.push(labels.slice(i, i + perSheet))

  const setCopies = (id: string, copies: number) =>
    setItems((current) => current.map((i) => (i.product.id === id ? { ...i, copies } : i)))

  const columns: Column<LabelItem, ItemColumn>[] = [
    {
      key: 'product',
      header: 'Producto',
      render: (i) => (
        <span className={styles.productCell}>
          {i.product.name}
          <span className={styles.muted}>
            {i.product.brand_name} · SKU {i.product.sku}
          </span>
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Precio final',
      align: 'end',
      render: (i) => formatMoney(i.product.sale_price_with_vat),
    },
    {
      key: 'copies',
      header: 'Copias',
      align: 'end',
      render: (i) => (
        <select
          className="select"
          aria-label={`Copias de ${i.product.name}`}
          value={i.copies}
          onChange={(e) => setCopies(i.product.id, Number(e.target.value))}
        >
          {COPY_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'remove',
      header: 'Quitar',
      align: 'end',
      render: (i) => (
        <Button
          variant="ghost"
          aria-label={`Quitar ${i.product.name}`}
          onClick={() => setItems((current) => current.filter((x) => x.product.id !== i.product.id))}
        >
          Quitar
        </Button>
      ),
    },
  ]

  const activeOptions = (rows: { id: string; name: string; is_active: boolean }[] | undefined) =>
    (rows ?? [])
      .filter((r) => r.is_active)
      .map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))

  const appliedChanges = (bulkChanges.data ?? []).filter((c) => c.status === 'applied')

  return (
    <>
      <PageHeader
        title="Etiquetas de góndola"
        description="Armá la lista de productos y se imprimen sus precios finales (con IVA) en hojas A4 de etiquetas."
      />

      <section className={styles.card} aria-labelledby="labels-add-title">
        <h2 id="labels-add-title" className={styles.title}>
          Agregar productos
        </h2>

        <FormField label="Producto" htmlFor="labels-product" hint="Buscá por nombre o código, o escanealo con el lector.">
          <ProductPicker
            id="labels-product"
            value={null}
            onChange={(p) => p && add.mutate(() => fetchLabelProducts(client, [p.id]))}
          />
        </FormField>

        <div className={styles.grid}>
          <div className={styles.source}>
            <FormField label="Marca" htmlFor="labels-brand">
              <select id="labels-brand" className="select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">Elegí una marca</option>
                {activeOptions(brands.data)}
              </select>
            </FormField>
            <Button
              disabled={!brandId || add.isPending}
              onClick={() => add.mutate(() => fetchLabelProductsByCatalog(client, 'brand_id', brandId))}
            >
              Agregar la marca
            </Button>
          </div>
          <div className={styles.source}>
            <FormField label="Categoría" htmlFor="labels-category">
              <select
                id="labels-category"
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Elegí una categoría</option>
                {activeOptions(categories.data)}
              </select>
            </FormField>
            <Button
              disabled={!categoryId || add.isPending}
              onClick={() => add.mutate(() => fetchLabelProductsByCatalog(client, 'category_id', categoryId))}
            >
              Agregar la categoría
            </Button>
          </div>
        </div>

        {canUseHistory && (
          <div className={styles.grid}>
            <div className={styles.source}>
              <FormField label="Productos de un aumento" htmlFor="labels-bulk" hint="Los que cambiaron de precio.">
                <select id="labels-bulk" className="select" value={bulkId} onChange={(e) => setBulkId(e.target.value)}>
                  <option value="">{appliedChanges.length === 0 ? 'No hay aumentos aplicados' : 'Elegí un aumento'}</option>
                  {appliedChanges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatDateTime(c.created_at)} · {c.percent > 0 ? '+' : ''}
                      {formatNumber(c.percent)} % · {countLabel(c.products_count, 'producto', 'productos')}
                      {c.notes ? ` · ${c.notes}` : ''}
                    </option>
                  ))}
                </select>
              </FormField>
              <Button
                disabled={!bulkId || add.isPending}
                onClick={() => add.mutate(fromIds(() => productIdsOfBulkChange(client, bulkId)))}
              >
                Agregar sus productos
              </Button>
            </div>
            <div className={styles.source}>
              <FormField
                label="Precios que cambiaron desde"
                htmlFor="labels-since"
                hint="Por aumentos o por edición del producto."
              >
                <input
                  id="labels-since"
                  type="date"
                  className="input"
                  value={since}
                  max={today}
                  onChange={(e) => setSince(e.target.value)}
                />
              </FormField>
              <Button
                disabled={!since || add.isPending}
                onClick={() => add.mutate(fromIds(() => productIdsChangedSince(client, since)))}
              >
                Agregar los cambiados
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="labels-list-title">
        <div className={styles.header}>
          <div>
            <h2 id="labels-list-title" className={styles.title}>
              Para imprimir
            </h2>
            <p className={styles.muted}>
              {items.length === 0
                ? 'Todavía no agregaste productos.'
                : `${countLabel(items.length, 'producto', 'productos')} · ${countLabel(labels.length, 'etiqueta', 'etiquetas')} · ${countLabel(sheets.length, 'hoja', 'hojas')}`}
            </p>
          </div>
          <div className={styles.actions}>
            <FormField label="Formato" htmlFor="labels-format">
              <select
                id="labels-format"
                className="select"
                value={format}
                onChange={(e) => setFormat(e.target.value as LabelFormat)}
              >
                {LABEL_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </FormField>
            <Button variant="ghost" disabled={items.length === 0} onClick={() => setItems([])}>
              Vaciar lista
            </Button>
            <Button variant="primary" disabled={items.length === 0} onClick={() => window.print()}>
              Imprimir etiquetas
            </Button>
          </div>
        </div>

        <DataTable
          caption="Productos para etiquetar"
          columns={columns}
          rows={items}
          rowKey={(i) => i.product.id}
          emptyTitle="Lista vacía"
          emptyDescription="Agregá productos sueltos, una marca, una categoría o los que cambiaron de precio."
        />
      </section>

      {sheets.length > 0 && (
        <section aria-labelledby="labels-preview-title">
          <h2 id="labels-preview-title" className={styles.title}>
            Vista previa
          </h2>
          <p className={styles.muted}>
            En el diálogo de impresión elegí tamaño A4, escala 100 % (o «tamaño real») y sin márgenes.
          </p>
          <style media="print">{'@page { size: A4; margin: 0; }'}</style>
          <div className={styles.printArea}>
            {sheets.map((sheet, s) => (
              <div key={s} className={styles.sheet} data-format={format} aria-label={`Hoja ${s + 1}`}>
                {sheet.map((p, n) => (
                  <ShelfLabel key={`${p.id}-${n}`} product={p} printedOn={today} />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function ShelfLabel({ product, printedOn }: { product: LabelProduct; printedOn: string }) {
  const suffix = PRICE_UNIT_SUFFIX[product.sale_unit]
  return (
    <article className={styles.label} aria-label={`Etiqueta de ${product.name}`}>
      <span className={styles.labelBrand}>{product.brand_name}</span>
      <span className={styles.labelName}>{product.name}</span>
      <span className={styles.labelPrice}>
        {formatMoney(product.sale_price_with_vat)}
        {suffix && <small> {suffix}</small>}
      </span>
      <span className={styles.labelMeta}>
        <span>{product.barcode ?? `SKU ${product.sku}`}</span>
        <span>{formatDate(printedOn)}</span>
      </span>
    </article>
  )
}
