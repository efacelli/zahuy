import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { bulkClassify, fetchMatchingIds, type ClassificationChange } from './list-api'
import type { ProductListParams } from './list-params'
import { useCatalogOptions } from './useCatalogOptions'
import styles from './BulkClassifyDialog.module.css'

interface BulkClassifyDialogProps {
  open: boolean
  params: ProductListParams
  /** Cuántos productos muestra el listado con el filtro actual. */
  total: number
  filtered: boolean
  onClose: () => void
}

/** Cambia categoría y/o marca de todos los productos del filtro actual (encargado y dueño). */
export function BulkClassifyDialog(props: BulkClassifyDialogProps) {
  if (!props.open) return null
  return <BulkClassifyContent {...props} />
}

function BulkClassifyContent({ params, total, filtered, onClose }: BulkClassifyDialogProps) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const categories = useCatalogOptions('categories')
  const brands = useCatalogOptions('brands')
  const [categoryId, setCategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [target, setTarget] = useState(total)

  async function apply() {
    setServerError(null)
    if (!categoryId && !brandId) {
      setError('Elegí una categoría, una marca o las dos.')
      return
    }
    setError(null)
    const change: ClassificationChange = {}
    if (categoryId) change.category_id = categoryId
    if (brandId) change.brand_id = brandId
    setRunning(true)
    try {
      const ids = await fetchMatchingIds(client, params)
      setTarget(ids.length)
      const updated = await bulkClassify(client, ids, change, setDone)
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(`Se actualizaron ${formatNumber(updated)} productos.`)
      onClose()
    } catch (e) {
      setServerError(
        `${toAppError(e).message} ${done > 0 ? `Se alcanzaron a actualizar ${formatNumber(done)}; podés repetir: no se duplica nada.` : ''}`.trim(),
      )
    } finally {
      setRunning(false)
    }
  }

  const select = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { id: string; name: string }[] | undefined,
  ) => (
    <FormField label={label} htmlFor={id}>
      <select id={id} className="select" value={value} disabled={running} onChange={(e) => onChange(e.target.value)}>
        <option value="">No cambiar</option>
        {options?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </FormField>
  )

  return (
    <Modal
      open
      title="Clasificar productos del listado"
      onClose={onClose}
      busy={running}
      footer={
        <>
          <Button onClick={onClose} disabled={running}>
            Cancelar
          </Button>
          <Button variant="primary" loading={running} onClick={() => void apply()}>
            Aplicar a {formatNumber(total)} productos
          </Button>
        </>
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      <p className={filtered ? styles.note : styles.warning}>
        {filtered
          ? `Se cambian los ${formatNumber(total)} productos que muestra el listado con el filtro y la búsqueda actuales (todas las páginas).`
          : `No hay ningún filtro: se cambiarían los ${formatNumber(total)} productos. Usá la búsqueda o los filtros para elegir cuáles.`}
      </p>
      <div className={styles.form}>
        {select('bulk-category', 'Nueva categoría', categoryId, setCategoryId, categories.data)}
        {select('bulk-brand', 'Nueva marca', brandId, setBrandId, brands.data)}
        {error && (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        )}
      </div>
      {running && (
        <p aria-live="polite">
          Actualizando {formatNumber(done)} de {formatNumber(target)}…
        </p>
      )}
    </Modal>
  )
}
