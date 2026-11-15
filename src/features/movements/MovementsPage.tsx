import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { Pagination } from '../../components/ui/Pagination'
import { MOVEMENT_TYPE_INFO, MOVEMENT_TYPES, movementTypesFor, type MovementType } from '../../domain/movements'
import { formatQuantity } from '../../domain/units'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { DEFAULT_PAGE_SIZE } from '../../lib/pagination'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { fetchMovementHistory, type MovementHistoryRow } from './movements-api'
import { ProductMovementDialog } from './ProductMovementDialog'
import { ReceiveStockDialog } from './ReceiveStockDialog'
import { ReverseMovementDialog } from './ReverseMovementDialog'
import styles from './Movements.module.css'

type ColumnKey = 'date' | 'product' | 'batch' | 'type' | 'quantity' | 'after' | 'reason' | 'author' | 'actions'

function parsePage(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 1
}

export function MovementsPage() {
  const client = useSupabase()
  const permissions = usePermissions()
  const [searchParams, setSearchParams] = useSearchParams()
  const typeParam = searchParams.get('tipo')
  const type = (MOVEMENT_TYPES as readonly string[]).includes(typeParam ?? '') ? (typeParam as MovementType) : null
  const page = parsePage(searchParams.get('pagina'))
  const params = useMemo(() => ({ type, page }), [type, page])

  const [receiving, setReceiving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [reversing, setReversing] = useState<MovementHistoryRow | null>(null)

  const query = useQuery({
    queryKey: ['movements', params],
    queryFn: () => fetchMovementHistory(client, params),
    placeholderData: keepPreviousData,
  })

  function update(next: { type?: MovementType | null; page?: number }) {
    const merged = { type, page: 1, ...next }
    const out = new URLSearchParams()
    if (merged.type) out.set('tipo', merged.type)
    if (merged.page > 1) out.set('pagina', String(merged.page))
    setSearchParams(out, { replace: next.page === undefined })
  }

  const movementTypes = movementTypesFor(permissions.registerAnyMovement)
  const canMove = permissions.registerAnyMovement || permissions.registerInternalUse

  const columns: Column<MovementHistoryRow, ColumnKey>[] = [
    { key: 'date', header: 'Fecha', render: (r) => <span className={styles.nowrap}>{formatDateTime(r.occurred_at)}</span> },
    {
      key: 'product',
      header: 'Producto',
      minWidth: '12rem',
      render: (r) => (
        <span className={styles.stack}>
          <strong>{r.batch?.product?.name ?? '—'}</strong>
          {r.batch?.product && <span className={styles.muted}>SKU {r.batch.product.sku}</span>}
        </span>
      ),
    },
    { key: 'batch', header: 'Lote', render: (r) => r.batch?.batch_number ?? <span className={styles.muted}>Sin número</span> },
    {
      key: 'type',
      header: 'Tipo',
      render: (r) => {
        const info = MOVEMENT_TYPE_INFO[r.movement_type]
        return (
          <span className={styles.stack}>
            <Badge tone={info.direction === 'in' ? 'success' : 'neutral'} icon={null}>
              {info.direction === 'in' ? '+ ' : '− '}
              {info.label}
            </Badge>
            {r.reverses_movement_id && <span className={styles.muted}>Anulación</span>}
          </span>
        )
      },
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      align: 'end',
      render: (r) => {
        const unit = r.batch?.product?.sale_unit ?? 'unit'
        const sign = r.signed_quantity >= 0 ? '+' : '−'
        return (
          <span className={r.signed_quantity >= 0 ? styles.in : styles.out}>
            {sign}
            {formatQuantity(Math.abs(r.signed_quantity), unit)}
          </span>
        )
      },
    },
    {
      key: 'after',
      header: 'Saldo del lote',
      align: 'end',
      render: (r) => formatQuantity(r.batch_quantity_after, r.batch?.product?.sale_unit ?? 'unit'),
    },
    { key: 'reason', header: 'Motivo', render: (r) => r.reason ?? <span className={styles.muted}>—</span> },
    { key: 'author', header: 'Usuario', render: (r) => r.author?.full_name ?? '—' },
    ...(permissions.reverseMovements
      ? ([
          {
            key: 'actions',
            header: 'Acciones',
            align: 'end',
            render: (r) =>
              r.reverses_movement_id ? null : r.is_reversed ? (
                <span className={styles.muted}>Anulado</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReversing(r)}
                  aria-label={`Anular ${MOVEMENT_TYPE_INFO[r.movement_type].label.toLowerCase()} de ${formatQuantity(r.quantity, r.batch?.product?.sale_unit ?? 'unit')} de ${r.batch?.product?.name ?? 'producto'}, ${formatDateTime(r.occurred_at)}`}
                >
                  Anular
                </Button>
              ),
          },
        ] as Column<MovementHistoryRow, ColumnKey>[])
      : []),
  ]

  const total = query.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Movimientos de stock"
        description="Ingresos de mercadería, salidas, ajustes, mermas, daños, devoluciones y consumo interno."
        actions={
          <>
            {permissions.receiveStock && (
              <Button variant="primary" onClick={() => setReceiving(true)}>
                + Ingreso de mercadería
              </Button>
            )}
            {canMove && (
              <Button onClick={() => setMoving(true)}>
                {permissions.registerAnyMovement ? 'Salida o ajuste' : 'Consumo interno'}
              </Button>
            )}
          </>
        }
      />

      <div className={styles.toolbar}>
        <select
          className="select"
          aria-label="Tipo de movimiento"
          value={type ?? ''}
          onChange={(e) => update({ type: (e.target.value || null) as MovementType | null })}
        >
          <option value="">Todos los tipos</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_INFO[t].label}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        caption="Historial de movimientos"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowKey={(r) => r.id}
        isLoading={query.isFetching}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle={type ? 'No hay movimientos de ese tipo' : 'Todavía no hay movimientos'}
        emptyDescription={type ? undefined : 'Registrá el primer ingreso de mercadería.'}
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

      <ReceiveStockDialog open={receiving} onClose={() => setReceiving(false)} />
      <ProductMovementDialog open={moving} types={movementTypes} onClose={() => setMoving(false)} />
      <ReverseMovementDialog movement={reversing} onClose={() => setReversing(null)} />
    </>
  )
}
