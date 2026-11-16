import { useQuery } from '@tanstack/react-query'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import {
  PRICE_HISTORY_LIMIT,
  PRICE_SOURCE_LABEL,
  fetchPriceHistory,
  priceHistoryKey,
  withVat,
  type PriceHistoryRow,
} from './price-history-api'
import styles from './ProductDetail.module.css'

type HistoryColumn = 'date' | 'price' | 'net' | 'cost' | 'source' | 'author' | 'reason'

interface Props {
  productId: string
  productName: string
  vatRate: number
}

/** Cambios de precio y costo del producto, del más nuevo al más viejo (§19.2). */
export function PriceHistorySection({ productId, productName, vatRate }: Props) {
  const client = useSupabase()
  const history = useQuery({ queryKey: priceHistoryKey(productId), queryFn: () => fetchPriceHistory(client, productId) })

  const error = history.error ? toAppError(history.error) : null
  const rows = history.data ?? []

  const columns: Column<PriceHistoryRow, HistoryColumn>[] = [
    { key: 'date', header: 'Fecha', render: (h) => formatDateTime(h.changed_at) },
    {
      key: 'price',
      header: 'Precio final',
      align: 'end',
      render: (h) =>
        h.old_sale_price === h.new_sale_price ? (
          <span className={styles.muted}>Sin cambio</span>
        ) : (
          <PriceChange from={withVat(h.old_sale_price, vatRate)} to={withVat(h.new_sale_price, vatRate)} />
        ),
    },
    {
      key: 'net',
      header: 'Sin IVA',
      align: 'end',
      render: (h) =>
        h.old_sale_price === h.new_sale_price ? '—' : `${formatMoney(h.old_sale_price)} → ${formatMoney(h.new_sale_price)}`,
    },
    {
      key: 'cost',
      header: 'Costo sin IVA',
      align: 'end',
      render: (h) =>
        h.old_cost_price === h.new_cost_price ? (
          <span className={styles.muted}>Sin cambio</span>
        ) : (
          `${formatMoney(h.old_cost_price)} → ${formatMoney(h.new_cost_price)}`
        ),
    },
    { key: 'source', header: 'Origen', render: (h) => PRICE_SOURCE_LABEL[h.source] ?? h.source },
    { key: 'author', header: 'Usuario', render: (h) => h.author?.full_name ?? '—' },
    { key: 'reason', header: 'Motivo o nota', render: (h) => h.reason ?? '—' },
  ]

  return (
    <>
      <h2 className={styles.sectionTitle}>Historial de precios</h2>
      {error?.kind === 'unavailable' ? (
        <p className={styles.muted}>El historial de precios todavía no está habilitado en la base.</p>
      ) : (
        <>
          <DataTable
            caption={`Cambios de precio de ${productName}`}
            columns={columns}
            rows={rows}
            rowKey={(h) => h.id}
            isLoading={history.isPending}
            errorMessage={error?.message ?? null}
            onRetry={() => void history.refetch()}
            emptyTitle="Sin cambios de precio"
            emptyDescription="Desde el 16/11/2026 cada cambio de precio o costo queda registrado acá."
          />
          {rows.length >= PRICE_HISTORY_LIMIT && (
            <p className={styles.more}>Se muestran los últimos {PRICE_HISTORY_LIMIT} cambios.</p>
          )}
        </>
      )}
    </>
  )
}

function PriceChange({ from, to }: { from: number; to: number }) {
  const percent = from > 0 ? ((to - from) / from) * 100 : null
  const sign = to > from ? '+' : '−'
  return (
    <span>
      {formatMoney(from)} → <strong>{formatMoney(to)}</strong>
      {percent !== null && (
        <span className={styles.muted}>
          {' '}
          ({sign}
          {Math.abs(percent).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %)
        </span>
      )}
    </span>
  )
}
