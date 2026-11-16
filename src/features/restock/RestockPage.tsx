import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { formatQuantity } from '../../domain/units'
import { formatDate, todayInAppTimeZone } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { countLabel } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { fetchRestockRows, groupBySupplier, type RestockGroup, type RestockItem } from './restock-api'
import styles from './Restock.module.css'

const ALL = '*'
const NONE = '-'

type ColumnKey = 'product' | 'stock' | 'min' | 'order' | 'boxes'

const columns: Column<RestockItem, ColumnKey>[] = [
  {
    key: 'product',
    header: 'Producto',
    minWidth: '14rem',
    render: (r) => (
      <span className={styles.stack}>
        <Link to={`/productos/${r.id}`}>{r.name}</Link>
        <span className={styles.muted}>
          SKU {r.sku} · {r.brand_name}
        </span>
      </span>
    ),
  },
  { key: 'stock', header: 'Stock', align: 'end', render: (r) => formatQuantity(r.stock_quantity, r.sale_unit) },
  { key: 'min', header: 'Mínimo', align: 'end', render: (r) => formatQuantity(r.min_stock, r.sale_unit) },
  {
    key: 'order',
    header: 'Pedir',
    align: 'end',
    render: (r) =>
      r.to_order > 0 ? (
        <strong>{formatQuantity(r.to_order, r.sale_unit)}</strong>
      ) : (
        <span className={styles.muted}>En el mínimo</span>
      ),
  },
  {
    key: 'boxes',
    header: 'Cajas',
    align: 'end',
    render: (r) =>
      r.boxes_to_order === null ? (
        <span className={styles.muted}>—</span>
      ) : (
        `${countLabel(r.boxes_to_order, 'caja', 'cajas')} de ${r.units_per_box}`
      ),
  },
]

/** Qué pedir a cada proveedor para volver al stock mínimo. Se puede imprimir. */
export function RestockPage() {
  const client = useSupabase()
  const [supplier, setSupplier] = useState(ALL)
  const query = useQuery({ queryKey: ['restock'], queryFn: () => fetchRestockRows(client) })

  const groups = useMemo(() => groupBySupplier(query.data ?? []), [query.data])
  const visible = useMemo(
    () =>
      groups.filter((g) => supplier === ALL || (supplier === NONE ? g.supplierId === null : g.supplierId === supplier)),
    [groups, supplier],
  )
  const total = visible.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      <PageHeader
        title="Reposición"
        description="Productos activos con stock en el mínimo o por debajo, agrupados por proveedor, con lo que falta para llegar al mínimo."
        actions={
          <Button icon="receipt" onClick={() => window.print()} disabled={total === 0}>
            Imprimir lista
          </Button>
        }
      />

      {groups.length > 0 && (
        <div className={styles.toolbar}>
          <select
            className="select"
            aria-label="Proveedor"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value={ALL}>Todos los proveedores</option>
            {groups.map((g) => (
              <option key={g.supplierId ?? NONE} value={g.supplierId ?? NONE}>
                {g.supplierName} ({g.items.length})
              </option>
            ))}
          </select>
          <span className={styles.muted} aria-live="polite">
            {countLabel(total, 'producto', 'productos')} para reponer
          </span>
        </div>
      )}

      <Content query={query} groups={visible} />
    </>
  )
}

function Content({
  query,
  groups,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => unknown }
  groups: RestockGroup[]
}) {
  if (query.error) return <ErrorState message={toAppError(query.error).message} onRetry={() => query.refetch()} />
  if (query.isPending) return <LoadingState />
  if (groups.length === 0)
    return (
      <EmptyState
        icon="check"
        title="No hay nada para reponer"
        description="Ningún producto activo con stock mínimo configurado está en el mínimo o por debajo. El mínimo se configura en la ficha de cada producto."
      />
    )

  return (
    <div className={styles.printArea}>
      <p className={styles.printTitle}>Lista de reposición · {formatDate(todayInAppTimeZone())}</p>
      {groups.map((g) => (
        <section key={g.supplierId ?? NONE} className={styles.group} aria-labelledby={`sup-${g.supplierId ?? NONE}`}>
          <h2 id={`sup-${g.supplierId ?? NONE}`} className={styles.groupTitle}>
            {g.supplierName}
            <span className={styles.muted}> · {countLabel(g.items.length, 'producto', 'productos')}</span>
          </h2>
          <DataTable caption={`Reponer de ${g.supplierName}`} columns={columns} rows={g.items} rowKey={(r) => r.id} />
        </section>
      ))}
    </div>
  )
}
