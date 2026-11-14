import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { EmptyState, ErrorState, LoadingState } from './States'
import styles from './DataTable.module.css'

export type SortDirection = 'asc' | 'desc'

export interface SortState<K extends string = string> {
  key: K
  direction: SortDirection
}

export interface Column<T, K extends string = string> {
  /** Identificador de la columna; si es ordenable, es la clave que se envía a la consulta. */
  key: K
  header: string
  render: (row: T) => ReactNode
  sortable?: boolean
  align?: 'start' | 'end' | 'center'
  /** Ancho mínimo sugerido, p. ej. '8rem'. */
  minWidth?: string
}

interface DataTableProps<T, K extends string> {
  /** Descripción de la tabla para lectores de pantalla. */
  caption: string
  columns: Column<T, K>[]
  rows: T[]
  rowKey: (row: T) => string
  sort?: SortState<K> | null
  onSortChange?: (sort: SortState<K>) => void
  isLoading?: boolean
  errorMessage?: string | null
  onRetry?: () => void
  emptyTitle?: string
  emptyDescription?: ReactNode
}

/**
 * Tabla administrativa. El orden y la paginación los resuelve la consulta en la
 * base; la tabla solo muestra el estado y avisa cambios de orden.
 */
export function DataTable<T, K extends string = string>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  isLoading = false,
  errorMessage,
  onRetry,
  emptyTitle = 'No hay resultados',
  emptyDescription,
}: DataTableProps<T, K>) {
  if (errorMessage) return <ErrorState message={errorMessage} onRetry={onRetry} />
  if (isLoading && rows.length === 0) return <LoadingState />
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />

  function toggleSort(key: K) {
    if (!onSortChange) return
    const direction: SortDirection = sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
    onSortChange({ key, direction })
  }

  return (
    <div className={styles.wrapper} aria-busy={isLoading || undefined}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort?.key === col.key
              const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={styles[col.align ?? 'start']}
                  style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                >
                  {col.sortable && onSortChange ? (
                    <button type="button" className={styles.sortButton} onClick={() => toggleSort(col.key)}>
                      {col.header}
                      <Icon
                        name={active ? (sort.direction === 'asc' ? 'sortAsc' : 'sortDesc') : 'sortNone'}
                        size={14}
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} className={styles[col.align ?? 'start']}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
