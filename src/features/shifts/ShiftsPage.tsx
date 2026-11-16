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
import { countLabel, formatMoney } from '../../lib/format'
import { DEFAULT_PAGE_SIZE } from '../../lib/pagination'
import { useSupabase } from '../../lib/supabase-context'
import { DifferenceBadge, ShiftDetailDialog } from './ShiftDetailDialog'
import { fetchShifts, type SessionStatus, type ShiftRow } from './shifts-api'
import styles from './Shifts.module.css'

type ColumnKey = 'register' | 'opened' | 'closed' | 'sales' | 'cash' | 'difference' | 'actions'

const STATUS_LABEL: Record<SessionStatus, string> = { open: 'Abiertas', closed: 'Cerradas' }

function parsePage(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 1
}

/** Turnos de caja: aperturas, cierres y arqueos (encargado y dueño). */
export function ShiftsPage() {
  const client = useSupabase()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('estado')
  const status: SessionStatus | null = statusParam === 'open' || statusParam === 'closed' ? statusParam : null
  const page = parsePage(searchParams.get('pagina'))
  const params = useMemo(() => ({ status, page }), [status, page])
  const [selected, setSelected] = useState<ShiftRow | null>(null)

  const query = useQuery({
    queryKey: ['cash-sessions', 'history', params],
    queryFn: () => fetchShifts(client, params),
    placeholderData: keepPreviousData,
  })

  function update(next: { status?: SessionStatus | null; page?: number }) {
    const merged = { status, page: 1, ...next }
    const out = new URLSearchParams()
    if (merged.status) out.set('estado', merged.status)
    if (merged.page > 1) out.set('pagina', String(merged.page))
    setSearchParams(out, { replace: next.page === undefined })
  }

  const columns: Column<ShiftRow, ColumnKey>[] = [
    { key: 'register', header: 'Caja', render: (r) => <strong className={styles.nowrap}>{r.cash_register_name}</strong> },
    {
      key: 'opened',
      header: 'Apertura',
      render: (r) => (
        <span className={styles.stack}>
          <span className={styles.nowrap}>{formatDateTime(r.opened_at)}</span>
          <span className={styles.muted}>
            {r.opener?.full_name ?? '—'} · {formatMoney(r.opening_amount)} inicial
          </span>
        </span>
      ),
    },
    {
      key: 'closed',
      header: 'Cierre',
      render: (r) =>
        r.status === 'open' ? (
          <Badge tone="info">Abierta</Badge>
        ) : (
          <span className={styles.stack}>
            <span className={styles.nowrap}>{r.closed_at ? formatDateTime(r.closed_at) : '—'}</span>
            <span className={styles.muted}>{r.closer?.full_name ?? '—'}</span>
          </span>
        ),
    },
    {
      key: 'sales',
      header: 'Ventas',
      align: 'end',
      render: (r) => (
        <span className={styles.stack}>
          {formatMoney(r.sales_total)}
          <span className={styles.muted}>
            {countLabel(r.sales_count, 'venta', 'ventas')}
            {r.voided_count > 0 && ` · ${countLabel(r.voided_count, 'anulada', 'anuladas')}`}
          </span>
        </span>
      ),
    },
    {
      key: 'cash',
      header: 'Efectivo esperado / contado',
      align: 'end',
      render: (r) => (
        <span className={styles.stack}>
          {r.expected_cash === null ? '—' : formatMoney(r.expected_cash)}
          <span className={styles.muted}>{r.counted_cash === null ? 'Sin contar' : `Contado ${formatMoney(r.counted_cash)}`}</span>
        </span>
      ),
    },
    {
      key: 'difference',
      header: 'Diferencia',
      render: (r) => (r.difference === null ? <span className={styles.muted}>—</span> : <DifferenceBadge value={r.difference} />),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelected(r)}
          aria-label={`Ver turno de ${r.cash_register_name} del ${formatDateTime(r.opened_at)}`}
        >
          Ver
        </Button>
      ),
    },
  ]

  const total = query.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Turnos de caja"
        description="Aperturas, cierres y arqueos. La diferencia es lo contado menos lo esperado: negativa es faltante."
      />

      <div className={styles.toolbar}>
        <select
          className="select"
          aria-label="Estado del turno"
          value={status ?? ''}
          onChange={(e) => update({ status: (e.target.value || null) as SessionStatus | null })}
        >
          <option value="">Todos</option>
          {(['open', 'closed'] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        caption="Turnos de caja"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.cash_session_id}
        isLoading={query.isFetching}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle={status ? 'No hay turnos en ese estado' : 'Todavía no hay turnos'}
        emptyDescription={status ? undefined : 'Los turnos aparecen cuando se abre una caja.'}
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

      <ShiftDetailDialog shift={selected} onClose={() => setSelected(null)} />
    </>
  )
}
