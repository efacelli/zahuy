import type { UseFormRegisterReturn } from 'react-hook-form'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { describedBy } from '../../components/ui/form-field-ids'
import { toAppError } from '../../lib/errors'
import type { CatalogTable } from './api'
import { useCatalogOptions } from './useCatalogOptions'
import styles from './ProductForm.module.css'

interface CatalogSelectProps {
  id: string
  label: string
  table: CatalogTable
  required: boolean
  /** Texto de la opción vacía. */
  placeholder: string
  error?: string
  registration: UseFormRegisterReturn
}

/** Select alimentado desde un catálogo real (categorías, marcas, proveedores). */
export function CatalogSelect({ id, label, table, required, placeholder, error, registration }: CatalogSelectProps) {
  const query = useCatalogOptions(table)
  const loadError = query.error ? toAppError(query.error).message : null
  const hint = loadError ?? (query.data?.length === 0 ? 'Todavía no hay opciones cargadas en Catálogos.' : undefined)

  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error}>
      <div className={styles.selectRow}>
        <select
          id={id}
          className="select"
          disabled={query.isPending || !!loadError}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { hint, error })}
          {...registration}
        >
          <option value="">{query.isPending ? 'Cargando…' : placeholder}</option>
          {query.data?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {loadError && (
          <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            Reintentar
          </Button>
        )}
      </div>
    </FormField>
  )
}
