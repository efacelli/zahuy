import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { Pagination } from '../../components/ui/Pagination'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { DEFAULT_PAGE_SIZE } from '../../lib/pagination'
import { useSupabase } from '../../lib/supabase-context'
import {
  ACTION_LABEL,
  AUDITED_TABLES,
  changedFields,
  fetchAuditLog,
  fetchProfileNames,
  fieldLabel,
  formatAuditValue,
  parseAuditParams,
  recordLabel,
  serializeAuditParams,
  type AuditRow,
} from './audit-api'
import styles from './AuditPage.module.css'

type ColumnKey = 'when' | 'who' | 'what' | 'action' | 'changes'

const MAX_CHANGES = 4

/** Quién cambió qué en las tablas editables (contrato §5.8). Solo el dueño. */
export function AuditPage() {
  const client = useSupabase()
  const [searchParams, setSearchParams] = useSearchParams()
  const params = useMemo(() => parseAuditParams(searchParams), [searchParams])

  const query = useQuery({
    queryKey: ['audit', params],
    queryFn: () => fetchAuditLog(client, params),
    placeholderData: keepPreviousData,
  })
  const names = useQuery({ queryKey: ['audit', 'profile-names'], queryFn: () => fetchProfileNames(client), staleTime: 60_000 })

  const columns: Column<AuditRow, ColumnKey>[] = [
    { key: 'when', header: 'Fecha', render: (r) => formatDateTime(r.changed_at) },
    {
      key: 'who',
      header: 'Usuario',
      render: (r) =>
        r.changed_by ? (names.data?.get(r.changed_by) ?? '—') : <span className={styles.muted}>Sistema (carga inicial)</span>,
    },
    {
      key: 'what',
      header: 'Registro',
      minWidth: '14rem',
      render: (r) => (
        <span className={styles.stack}>
          {r.table_name === 'products' && r.action !== 'delete' ? (
            <Link to={`/productos/${r.record_id}`}>{recordLabel(r)}</Link>
          ) : (
            <span>{recordLabel(r)}</span>
          )}
          <span className={styles.muted}>{AUDITED_TABLES[r.table_name] ?? r.table_name}</span>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Acción',
      render: (r) => (
        <Badge tone={r.action === 'delete' ? 'danger' : r.action === 'insert' ? 'success' : 'neutral'} icon={null}>
          {ACTION_LABEL[r.action]}
        </Badge>
      ),
    },
    {
      key: 'changes',
      header: 'Cambios',
      minWidth: '18rem',
      render: (r) => {
        if (r.action === 'insert') return <span className={styles.muted}>Se creó el registro.</span>
        if (r.action === 'delete') return <span className={styles.muted}>Se borró el registro.</span>
        const changes = changedFields(r)
        if (changes.length === 0) return <span className={styles.muted}>Sin cambios visibles.</span>
        return (
          <ul className={styles.changes}>
            {changes.slice(0, MAX_CHANGES).map((c) => (
              <li key={c.field}>
                <strong>{fieldLabel(c.field)}</strong>: {formatAuditValue(c.before)} → {formatAuditValue(c.after)}
              </li>
            ))}
            {changes.length > MAX_CHANGES && <li className={styles.muted}>y {changes.length - MAX_CHANGES} más</li>}
          </ul>
        )
      },
    },
  ]

  const total = query.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Quién creó, editó o borró productos, lotes, catálogos, usuarios y días de alerta. Los movimientos de stock están en su propio historial."
      />
      <div className={styles.toolbar}>
        <label className={styles.filter}>
          <span>Qué</span>
          <select
            className="select"
            value={params.table ?? ''}
            onChange={(e) => setSearchParams(serializeAuditParams({ table: e.target.value || null, page: 1 }), { replace: true })}
          >
            <option value="">Todo</option>
            {Object.entries(AUDITED_TABLES).map(([table, label]) => (
              <option key={table} value={table}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DataTable
        caption="Registro de auditoría"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => String(r.id)}
        isLoading={query.isPending}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No hay cambios registrados"
      />
      <Pagination
        page={params.page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={total}
        disabled={query.isFetching}
        onPageChange={(page) => setSearchParams(serializeAuditParams({ ...params, page }))}
      />
    </>
  )
}
