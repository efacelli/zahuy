import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { Pagination } from '../../components/ui/Pagination'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney } from '../../lib/format'
import { DEFAULT_PAGE_SIZE } from '../../lib/pagination'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { SaleDetailDialog } from './SaleDetailDialog'
import { chargedAmount, fetchSales, SALE_STATUS_LABEL, SALE_STATUSES, type SaleRow, type SaleStatus } from './sales-api'
import styles from './Sales.module.css'

type ColumnKey = 'number' | 'date' | 'register' | 'seller' | 'total' | 'charged' | 'payments' | 'status' | 'actions'

function parsePage(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 1
}

export function SalesPage() {
  const client = useSupabase()
  // Anular ventas es del encargado y el dueño, igual que revertir movimientos (§15.7).
  const canVoid = usePermissions().reverseMovements
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('estado')
  const status = (SALE_STATUSES as readonly string[]).includes(statusParam ?? '') ? (statusParam as SaleStatus) : null
  const page = parsePage(searchParams.get('pagina'))
  const params = useMemo(() => ({ status, page }), [status, page])
  const [selected, setSelected] = useState<SaleRow | null>(null)

  const query = useQuery({
    queryKey: ['sales', params],
    queryFn: () => fetchSales(client, params),
    placeholderData: keepPreviousData,
  })

  function update(next: { status?: SaleStatus | null; page?: number }) {
    const merged = { status, page: 1, ...next }
    const out = new URLSearchParams()
    if (merged.status) out.set('estado', merged.status)
    if (merged.page > 1) out.set('pagina', String(merged.page))
    setSearchParams(out, { replace: next.page === undefined })
  }

  const columns: Column<SaleRow, ColumnKey>[] = [
    { key: 'number', header: 'N.º', render: (r) => <strong>{r.sale_number}</strong> },
    { key: 'date', header: 'Fecha', render: (r) => <span className={styles.nowrap}>{formatDateTime(r.created_at)}</span> },
    { key: 'register', header: 'Caja', render: (r) => r.cash_session?.cash_register?.name ?? '—' },
    { key: 'seller', header: 'Vendió', render: (r) => r.seller?.full_name ?? '—' },
    { key: 'total', header: 'Total', align: 'end', render: (r) => formatMoney(r.total_amount) },
    {
      key: 'charged',
      header: 'Cobrado',
      align: 'end',
      render: (r) => (
        <span className={styles.stack}>
          {formatMoney(chargedAmount(r))}
          {r.rounding_amount !== 0 && <span className={styles.muted}>Redondeo {formatMoney(r.rounding_amount)}</span>}
        </span>
      ),
    },
    {
      key: 'payments',
      header: 'Medios',
      render: (r) => r.sale_payments.map((p) => p.payment_method?.name ?? 'Pago').join(', '),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (r) => (
        <Badge tone={r.status === 'completed' ? 'success' : 'danger'}>{SALE_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setSelected(r)} aria-label={`Ver venta n.º ${r.sale_number}`}>
          Ver
        </Button>
      ),
    },
  ]

  const total = query.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Ventas"
        description={
          canVoid
            ? 'Comprobantes internos de todas las cajas. Reimprimí un ticket o anulá una venta mientras su caja siga abierta.'
            : 'Tus ventas. Podés ver el detalle y reimprimir el ticket.'
        }
      />

      <div className={styles.toolbar}>
        <select
          className="select"
          aria-label="Estado de la venta"
          value={status ?? ''}
          onChange={(e) => update({ status: (e.target.value || null) as SaleStatus | null })}
        >
          <option value="">Todas</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SALE_STATUS_LABEL[s]}s
            </option>
          ))}
        </select>
      </div>

      <DataTable
        caption="Ventas"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        isLoading={query.isFetching}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle={status ? 'No hay ventas en ese estado' : 'Todavía no hay ventas'}
        emptyDescription={status ? undefined : 'Las ventas que se cobren en la caja aparecen acá.'}
      />
      {total > 0 && (
        <Pagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          total={total}
          onPageChange={(p) => update({ page: p })}
          disabled={query.isFetching}
        />
      )}

      <SaleDetailDialog sale={selected} canVoid={canVoid} onClose={() => setSelected(null)} />
    </>
  )
}
