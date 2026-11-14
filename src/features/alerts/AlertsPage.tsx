import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ExpiryBadge } from '../../components/domain/ExpiryBadge'
import { Badge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { Pagination } from '../../components/ui/Pagination'
import { formatQuantity } from '../../domain/units'
import { formatDate, todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { DEFAULT_PAGE_SIZE } from '../../lib/pagination'
import { useSupabase } from '../../lib/supabase-context'
import { useCatalogOptions } from '../products/useCatalogOptions'
import {
  ALERT_FILTERS,
  fetchAlerts,
  parseAlertParams,
  serializeAlertParams,
  type AlertFilter,
  type AlertParams,
  type BatchAlertRow,
} from './alerts-api'
import styles from './AlertsPage.module.css'

const FILTER_LABEL: Record<AlertFilter, string> = {
  todas: 'Todas',
  vencidos: 'Vencidos',
  urgentes: 'Urgentes',
  proximos: 'Próximos a vencer',
}

type ColumnKey = 'product' | 'category' | 'batch' | 'received' | 'quantity' | 'expiry'

/** Lotes con stock que vencen pronto o ya vencieron (contrato v0.4.2 §4.4 y §7.1). */
export function AlertsPage() {
  const client = useSupabase()
  const categories = useCatalogOptions('categories')
  const [searchParams, setSearchParams] = useSearchParams()
  const params = useMemo(() => parseAlertParams(searchParams), [searchParams])
  const today = todayInAppTimeZone()
  const [search, setSearch] = useState(params.search)
  // Si la URL cambia desde afuera (atrás/adelante), el campo la sigue.
  const [urlSearch, setUrlSearch] = useState(params.search)
  if (params.search !== urlSearch) {
    setUrlSearch(params.search)
    setSearch(params.search)
  }

  const query = useQuery({
    queryKey: ['alerts', params],
    queryFn: () => fetchAlerts(client, params),
    placeholderData: keepPreviousData,
  })

  const update = useCallback(
    (next: Partial<AlertParams>) => {
      setSearchParams(serializeAlertParams({ ...params, page: 1, ...next }), { replace: !('page' in next) })
    },
    [params, setSearchParams],
  )

  const columns: Column<BatchAlertRow, ColumnKey>[] = [
    {
      key: 'product',
      header: 'Producto',
      minWidth: '14rem',
      render: (r) => (
        <span className={styles.product}>
          <Link to={`/productos?q=${encodeURIComponent(r.product_sku)}&estado=todos`}>{r.product_name}</Link>
          <span className={styles.muted}>
            SKU {r.product_sku}
            {!r.product_is_active && ' · inactivo'}
          </span>
        </span>
      ),
    },
    { key: 'category', header: 'Categoría', render: (r) => r.category_name },
    { key: 'batch', header: 'Lote', render: (r) => r.batch_number ?? <span className={styles.muted}>Sin número</span> },
    { key: 'received', header: 'Ingreso', render: (r) => formatDate(r.received_on) },
    { key: 'quantity', header: 'Disponible', align: 'end', render: (r) => formatQuantity(r.quantity_available, r.sale_unit) },
    {
      key: 'expiry',
      header: 'Vencimiento',
      render: (r) => <ExpiryBadge expiresOn={r.expires_on} status={r.expiry_status} today={today} />,
    },
  ]

  const total = query.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Lotes con stock que vencen pronto o ya vencieron. Los agotados no aparecen."
      />

      <div className={styles.toolbar}>
        <div className={styles.levels} role="group" aria-label="Nivel de alerta">
          {ALERT_FILTERS.map((level) => (
            <button
              key={level}
              type="button"
              className={`${styles.level} ${params.level === level ? styles.levelActive : ''}`}
              aria-pressed={params.level === level}
              onClick={() => update({ level })}
            >
              {FILTER_LABEL[level]}
            </button>
          ))}
        </div>
        <form
          className={styles.search}
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            update({ search })
          }}
        >
          <input
            type="search"
            className="input"
            aria-label="Buscar por producto, SKU o lote"
            placeholder="Buscar por producto, SKU o lote"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search !== params.search && update({ search })}
          />
        </form>
        <select
          className="select"
          aria-label="Categoría"
          value={params.categoryId ?? ''}
          onChange={(e) => update({ categoryId: e.target.value || null })}
        >
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {params.level === 'vencidos' && total > 0 && (
        <p className={styles.notice}>
          <Badge tone="danger">Vencidos</Badge> Lo vencido no se vende: registrá la merma desde Movimientos.
        </p>
      )}

      <DataTable
        caption="Alertas de vencimiento"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        isLoading={query.isFetching}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle={params.level === 'todas' && !params.search && !params.categoryId ? 'No hay alertas' : 'No hay alertas con esos filtros'}
        emptyDescription="Ningún lote con stock está vencido ni por vencer."
      />
      {total > 0 && (
        <Pagination
          page={params.page}
          pageSize={DEFAULT_PAGE_SIZE}
          total={total}
          onPageChange={(page) => update({ page })}
          disabled={query.isFetching}
        />
      )}
    </>
  )
}
