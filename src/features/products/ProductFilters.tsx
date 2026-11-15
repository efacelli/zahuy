import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import {
  DEFAULT_LIST_PARAMS,
  NO_SUPPLIER,
  hasActiveFilters,
  type ExpiryFilter,
  type ProductListParams,
  type StatusFilter,
} from './list-params'
import { useCatalogOptions } from './useCatalogOptions'
import styles from './ProductsPage.module.css'

interface ProductFiltersProps {
  params: ProductListParams
  onChange: (next: Partial<ProductListParams>) => void
}

const SEARCH_DELAY_MS = 300

export function ProductFilters({ params, onChange }: ProductFiltersProps) {
  const categories = useCatalogOptions('categories')
  const suppliers = useCatalogOptions('suppliers')

  // La búsqueda se aplica al dejar de escribir, no en cada tecla.
  const [search, setSearch] = useState(params.search)
  // Si la URL cambia desde afuera (Limpiar filtros, atrás/adelante), el campo la sigue.
  const [urlSearch, setUrlSearch] = useState(params.search)
  if (params.search !== urlSearch) {
    setUrlSearch(params.search)
    setSearch(params.search)
  }
  useEffect(() => {
    if (search === params.search) return
    const timer = window.setTimeout(() => onChange({ search }), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search, params.search, onChange])

  return (
    <div className={styles.filters} role="search" aria-label="Buscar y filtrar productos">
      <input
        type="search"
        className={`input ${styles.search}`}
        placeholder="Buscar por nombre, SKU, código de barras o código anterior"
        aria-label="Buscar por nombre, SKU o código de barras"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onChange({ search })}
      />

      <select
        className="select"
        aria-label="Categoría"
        value={params.categoryId ?? ''}
        onChange={(e) => onChange({ categoryId: e.target.value || null })}
      >
        <option value="">Todas las categorías</option>
        {categories.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        className="select"
        aria-label="Proveedor"
        value={params.supplierId ?? ''}
        onChange={(e) => onChange({ supplierId: e.target.value || null })}
      >
        <option value="">Todos los proveedores</option>
        <option value={NO_SUPPLIER}>Sin proveedor</option>
        {suppliers.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        className="select"
        aria-label="Vencimiento"
        value={params.expiry ?? ''}
        onChange={(e) => onChange({ expiry: (e.target.value || null) as ExpiryFilter | null })}
      >
        <option value="">Cualquier vencimiento</option>
        <option value="por_vencer">Por vencer</option>
        <option value="urgente">Vencimiento urgente</option>
        <option value="vencido">Con lotes vencidos</option>
      </select>

      <select
        className="select"
        aria-label="Estado"
        value={params.status}
        onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
      >
        <option value="activos">Activos</option>
        <option value="inactivos">Inactivos</option>
        <option value="todos">Activos e inactivos</option>
      </select>

      <label className={styles.checkbox}>
        <input type="checkbox" checked={params.lowStock} onChange={(e) => onChange({ lowStock: e.target.checked })} />
        Solo stock bajo
      </label>

      {hasActiveFilters(params) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSearch('')
            onChange({ ...DEFAULT_LIST_PARAMS, sort: params.sort, direction: params.direction })
          }}
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  )
}
