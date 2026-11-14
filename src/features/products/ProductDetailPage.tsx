import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import pageStyles from '../../app/pages.module.css'
import { ExpiryBadge } from '../../components/domain/ExpiryBadge'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { MOVEMENT_TYPE_INFO } from '../../domain/movements'
import { SALE_UNIT_LABEL, formatQuantity } from '../../domain/units'
import { formatVatRate } from '../../domain/vat'
import { formatDate, formatDateTime, todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchProductBatches, type BatchAlertRow } from '../alerts/alerts-api'
import { usePermissions } from '../auth/useProfile'
import { fetchMovementHistory, type MovementHistoryRow } from '../movements/movements-api'
import { BoxCountDialog } from './BoxCountDialog'
import { fetchProductSummary } from './list-api'
import styles from './ProductDetail.module.css'

type BatchColumn = 'batch' | 'received' | 'expiry' | 'available'
type MovementColumn = 'date' | 'type' | 'quantity' | 'batch' | 'reason' | 'author'

/** Ficha del producto: datos, stock con desglose, lotes y últimos movimientos. */
export function ProductDetailPage() {
  const { id = '' } = useParams()
  const client = useSupabase()
  const permissions = usePermissions()
  const today = todayInAppTimeZone()
  const [editingBoxes, setEditingBoxes] = useState(false)

  const product = useQuery({ queryKey: ['products', 'detail', id], queryFn: () => fetchProductSummary(client, id) })
  const batches = useQuery({ queryKey: ['products', 'batches', id], queryFn: () => fetchProductBatches(client, id) })
  const movements = useQuery({
    queryKey: ['movements', { productId: id, type: null, page: 1 }],
    queryFn: () => fetchMovementHistory(client, { productId: id, type: null, page: 1 }),
  })

  if (product.isPending) return <LoadingState label="Cargando producto…" />
  if (product.error) {
    const missing = (product.error as { code?: string }).code === 'PGRST116'
    return (
      <ErrorState
        title={missing ? 'No encontramos ese producto' : 'No se pudo cargar el producto'}
        message={missing ? 'Puede que el enlace esté mal o que el producto no exista.' : toAppError(product.error).message}
        onRetry={missing ? undefined : () => void product.refetch()}
        action={<Link to="/productos">Volver a Productos</Link>}
      />
    )
  }

  const p = product.data
  const unit = p.sale_unit

  const batchColumns: Column<BatchAlertRow, BatchColumn>[] = [
    { key: 'batch', header: 'Lote', render: (b) => b.batch_number ?? <span className={styles.muted}>Sin número</span> },
    { key: 'received', header: 'Ingreso', render: (b) => formatDate(b.received_on) },
    { key: 'expiry', header: 'Vencimiento', render: (b) => <ExpiryBadge expiresOn={b.expires_on} status={b.expiry_status} today={today} /> },
    {
      key: 'available',
      header: 'Disponible',
      align: 'end',
      render: (b) =>
        b.quantity_available > 0 ? formatQuantity(b.quantity_available, unit) : <Badge tone="neutral" icon={null}>Agotado</Badge>,
    },
  ]

  const movementColumns: Column<MovementHistoryRow, MovementColumn>[] = [
    { key: 'date', header: 'Fecha', render: (m) => formatDateTime(m.occurred_at) },
    {
      key: 'type',
      header: 'Tipo',
      render: (m) => `${MOVEMENT_TYPE_INFO[m.movement_type].label}${m.reverses_movement_id ? ' (anulación)' : ''}`,
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      align: 'end',
      render: (m) => `${m.signed_quantity >= 0 ? '+' : '−'}${formatQuantity(Math.abs(m.signed_quantity), unit)}`,
    },
    { key: 'batch', header: 'Lote', render: (m) => m.batch?.batch_number ?? '—' },
    { key: 'reason', header: 'Motivo', render: (m) => m.reason ?? '—' },
    { key: 'author', header: 'Usuario', render: (m) => m.author?.full_name ?? '—' },
  ]

  return (
    <>
      <p className={styles.back}>
        <Link to="/productos">← Productos</Link>
      </p>
      <PageHeader
        title={p.name}
        description={`SKU ${p.sku}${p.barcode ? ` · Código de barras ${p.barcode}` : ''}`}
        actions={
          <>
            {permissions.updateBoxCount && <Button onClick={() => setEditingBoxes(true)}>Actualizar cajas</Button>}
            {permissions.manageInventory && (
              <Link to={`/productos/${p.id}/editar`} className={pageStyles.linkButton}>
                Editar producto
              </Link>
            )}
          </>
        }
      />

      <div className={styles.badges}>
        {p.is_active ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral">Inactivo</Badge>}
        {p.is_low_stock && <Badge tone="warning" icon="warning">Stock bajo</Badge>}
        {p.has_box_mismatch && <Badge tone="urgent" icon="warning">Revisar cajas</Badge>}
      </div>

      <section className={styles.cards} aria-label="Resumen">
        <div className={styles.card}>
          <span className={styles.cardLabel}>Stock</span>
          <strong className={styles.cardValue}>{formatQuantity(p.stock_quantity, unit)}</strong>
          {p.boxes_quantity > 0 && !p.has_box_mismatch && (
            <span className={styles.muted}>
              {formatQuantity(p.loose_units, unit)} sueltas + {formatNumber(p.boxes_quantity)} cajas de {formatNumber(p.units_per_box)}
            </span>
          )}
          <span className={styles.muted}>Mínimo: {formatQuantity(p.min_stock, unit)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Precio final</span>
          <strong className={styles.cardValue}>{formatMoney(p.sale_price_with_vat)}</strong>
          <span className={styles.muted}>
            {formatMoney(p.sale_price)} sin IVA · IVA {formatVatRate(p.vat_rate)}
          </span>
          <span className={styles.muted}>Costo sin IVA: {formatMoney(p.cost_price)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Próximo vencimiento</span>
          <ExpiryBadge expiresOn={p.next_expires_on} status={p.next_expiry_status} today={today} />
          <span className={styles.muted}>{p.active_batches_count} lotes con stock</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Clasificación</span>
          <span>
            {p.category_name} · {p.brand_name}
          </span>
          <span className={styles.muted}>{p.supplier_name ?? 'Sin proveedor'}</span>
          <span className={styles.muted}>Se vende por {SALE_UNIT_LABEL[unit].toLowerCase()}</span>
        </div>
      </section>

      <h2 className={styles.sectionTitle}>Lotes</h2>
      <DataTable
        caption={`Lotes de ${p.name}`}
        columns={batchColumns}
        rows={batches.data ?? []}
        rowKey={(b) => b.id}
        isLoading={batches.isPending}
        errorMessage={batches.error ? toAppError(batches.error).message : null}
        onRetry={() => void batches.refetch()}
        emptyTitle="Sin lotes"
        emptyDescription="Todavía no se registró ningún ingreso de este producto."
      />

      <h2 className={styles.sectionTitle}>Últimos movimientos</h2>
      <DataTable
        caption={`Movimientos de ${p.name}`}
        columns={movementColumns}
        rows={movements.data?.rows ?? []}
        rowKey={(m) => m.id}
        isLoading={movements.isPending}
        errorMessage={movements.error ? toAppError(movements.error).message : null}
        onRetry={() => void movements.refetch()}
        emptyTitle="Sin movimientos"
      />
      {(movements.data?.total ?? 0) > (movements.data?.rows.length ?? 0) && (
        <p className={styles.more}>
          Se muestran los últimos {movements.data?.rows.length}. El historial completo está en{' '}
          <Link to="/movimientos">Movimientos</Link>.
        </p>
      )}

      <BoxCountDialog product={editingBoxes ? p : null} onClose={() => setEditingBoxes(false)} />
    </>
  )
}
