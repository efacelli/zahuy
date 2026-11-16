import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import pageStyles from '../../app/pages.module.css'
import { ExpiryBadge } from '../../components/domain/ExpiryBadge'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column, type SortState } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { Pagination } from '../../components/ui/Pagination'
import { useToast } from '../../components/ui/toast-context'
import { formatQuantity } from '../../domain/units'
import { formatVatRate } from '../../domain/vat'
import { todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { downloadText, fetchAllProducts, productsToCsv } from './export-csv'
import { fetchProductList, type ProductListRow } from './list-api'
import { hasActiveFilters, parseListParams, serializeListParams, type ProductListParams, type ProductSortKey } from './list-params'
import { BulkClassifyDialog } from './BulkClassifyDialog'
import { ProductFilters } from './ProductFilters'
import styles from './ProductsPage.module.css'

type ColumnKey = ProductSortKey | 'barcode' | 'vat_rate' | 'status'

export function ProductsPage() {
  const client = useSupabase()
  const canManage = usePermissions().manageInventory
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const params = useMemo(() => parseListParams(searchParams), [searchParams])
  const today = todayInAppTimeZone()
  const [classifying, setClassifying] = useState(false)

  const query = useQuery({
    queryKey: ['products', 'list', params],
    queryFn: () => fetchProductList(client, params),
    placeholderData: keepPreviousData,
  })

  const update = useCallback(
    (next: Partial<ProductListParams>) => {
      // Cualquier cambio de filtro u orden vuelve a la página 1.
      const merged = { ...params, page: 1, ...next }
      setSearchParams(serializeListParams(merged), { replace: !('page' in next) })
    },
    [params, setSearchParams],
  )

  const columns: Column<ProductListRow, ColumnKey>[] = [
    { key: 'sku', header: 'SKU', sortable: true, render: (r) => <span className={styles.mono}>{r.sku}</span> },
    {
      key: 'barcode',
      header: 'Código de barras',
      render: (r) => (r.barcode ? <span className={styles.mono}>{r.barcode}</span> : <span className={styles.muted}>—</span>),
    },
    {
      key: 'name',
      header: 'Nombre',
      sortable: true,
      minWidth: '14rem',
      render: (r) => (
        <Link to={`/productos/${r.id}`} className={styles.name}>
          {r.name}
        </Link>
      ),
    },
    { key: 'brand_name', header: 'Marca', sortable: true, render: (r) => r.brand_name },
    { key: 'category_name', header: 'Categoría', sortable: true, render: (r) => r.category_name },
    {
      key: 'supplier_name',
      header: 'Proveedor',
      sortable: true,
      render: (r) => r.supplier_name ?? <span className={styles.muted}>Sin proveedor</span>,
    },
    { key: 'cost_price', header: 'Costo s/IVA', sortable: true, align: 'end', render: (r) => formatMoney(r.cost_price) },
    { key: 'sale_price', header: 'Precio s/IVA', sortable: true, align: 'end', render: (r) => formatMoney(r.sale_price) },
    {
      key: 'sale_price_with_vat',
      header: 'Precio final',
      sortable: true,
      align: 'end',
      render: (r) => <strong>{formatMoney(r.sale_price_with_vat)}</strong>,
    },
    { key: 'vat_rate', header: 'IVA', align: 'end', render: (r) => formatVatRate(r.vat_rate) },
    {
      key: 'stock_quantity',
      header: 'Stock',
      sortable: true,
      align: 'end',
      render: (r) => (
        <span className={styles.stock}>
          {formatQuantity(r.stock_quantity, r.sale_unit)}
          {r.boxes_quantity > 0 && !r.has_box_mismatch && (
            <span className={styles.breakdown}>
              {formatQuantity(r.loose_units, r.sale_unit)} sueltas + {formatNumber(r.boxes_quantity)}{' '}
              {r.boxes_quantity === 1 ? 'caja' : 'cajas'} de {formatNumber(r.units_per_box)}
            </span>
          )}
          {r.has_box_mismatch && (
            <Badge tone="urgent" icon="warning">
              Revisar cajas
            </Badge>
          )}
          {r.is_low_stock && <Badge tone="warning" icon="warning">Stock bajo</Badge>}
        </span>
      ),
    },
    { key: 'boxes_quantity', header: 'Cajas', sortable: true, align: 'end', render: (r) => formatNumber(r.boxes_quantity) },
    {
      key: 'next_expires_on',
      header: 'Próximo vencimiento',
      sortable: true,
      render: (r) => <ExpiryBadge expiresOn={r.next_expires_on} status={r.next_expiry_status} today={today} />,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (r) => (r.is_active ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral">Inactivo</Badge>),
    },
  ]

  const sort: SortState<ColumnKey> = { key: params.sort, direction: params.direction }
  const filtered = hasActiveFilters(params)
  const total = query.data?.total ?? 0

  /** Baja todo el listado (con los filtros y el orden de la pantalla), no solo la página visible. */
  async function exportList() {
    setExporting(true)
    try {
      const rows = await fetchAllProducts(client, params)
      downloadText(`productos-${todayInAppTimeZone()}.csv`, productsToCsv(rows))
      toast.success(`Se exportaron ${formatNumber(rows.length)} productos.`)
    } catch (error) {
      toast.error(toAppError(error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Productos"
        description="Catálogo, stock y próximos vencimientos."
        actions={
          <>
            <Button disabled={exporting || total === 0} onClick={() => void exportList()}>
              {exporting ? 'Exportando…' : 'Exportar a Excel'}
            </Button>
            {canManage && (
              <>
                <Link to="/productos/importar">Importar</Link>
                <Link to="/productos/nuevo" className={pageStyles.linkButton}>
                  + Nuevo producto
                </Link>
              </>
            )}
          </>
        }
      />
      <ProductFilters params={params} onChange={update} />
      {canManage && total > 0 && (
        <div className={styles.bulkBar}>
          <button type="button" className={styles.bulkButton} onClick={() => setClassifying(true)}>
            Clasificar los {formatNumber(total)} del listado
          </button>
        </div>
      )}
      <BulkClassifyDialog
        open={classifying}
        params={params}
        total={total}
        filtered={filtered}
        onClose={() => setClassifying(false)}
      />
      <DataTable
        caption="Listado de productos"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={(s) => update({ sort: s.key as ProductSortKey, direction: s.direction })}
        isLoading={query.isFetching}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle={filtered ? 'No hay productos con esos filtros' : 'Todavía no hay productos'}
        emptyDescription={
          filtered
            ? 'Probá con otra búsqueda o limpiá los filtros.'
            : canManage
              ? 'Cargá el primero con "+ Nuevo producto".'
              : 'El encargado todavía no cargó productos.'
        }
      />
      {total > 0 && (
        <Pagination
          page={params.page}
          pageSize={params.pageSize}
          total={total}
          onPageChange={(page) => update({ page })}
          disabled={query.isFetching}
        />
      )}
    </>
  )
}
