import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { isBarcodeLike, normalizeBarcode } from '../../domain/barcode'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { findProductByBarcode, searchProducts, type ProductOption } from './movements-api'
import styles from './Movements.module.css'

interface ProductPickerProps {
  id: string
  value: ProductOption | null
  onChange: (product: ProductOption | null) => void
  error?: string
  /** Suma productos inactivos, marcados como tales (para darlos de baja, P-13). */
  includeInactive?: boolean
  /** Campo que recibe el foco después de elegir (por ejemplo, la cantidad). */
  nextFocusId?: string
}

const SEARCH_DELAY_MS = 250

/** Buscador de productos por nombre, SKU o código de barras. */
export function ProductPicker({ id, value, onChange, error, includeInactive = false, nextFocusId }: ProductPickerProps) {
  const client = useSupabase()
  const listId = useId()
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  const query = useQuery({
    queryKey: ['product-options', term, includeInactive],
    queryFn: () => searchProducts(client, term, { includeInactive }),
    enabled: value === null,
    staleTime: 30_000,
  })

  function choose(product: ProductOption) {
    setScanMessage(null)
    onChange(product)
    if (nextFocusId) window.requestAnimationFrame(() => document.getElementById(nextFocusId)?.focus())
  }

  /** Enter: un código de barras (lector USB) elige el producto exacto; un texto con un solo resultado, ese. */
  async function onEnter() {
    const raw = text.trim()
    if (isBarcodeLike(raw)) {
      const code = normalizeBarcode(raw)
      try {
        const product = await findProductByBarcode(client, code, { includeInactive })
        if (product) choose(product)
        else setScanMessage(`No hay ningún producto${includeInactive ? '' : ' activo'} con el código ${code}.`)
      } catch (e) {
        setScanMessage(toAppError(e).message)
      }
      return
    }
    const only = query.data?.length === 1 && term === text ? query.data[0] : undefined
    if (only) choose(only)
  }

  if (value) {
    return (
      <div className={styles.picked}>
        <div>
          <strong>{value.name}</strong>
          <span className={styles.muted}> · SKU {value.sku}</span>
          {!value.is_active && <span className={styles.muted}> · inactivo</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Cambiar
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.picker}>
      <input
        id={id}
        type="search"
        className="input"
        autoComplete="off"
        placeholder="Buscar por nombre, SKU o código de barras"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-controls={listId}
        value={text}
        onChange={(e) => {
          setScanMessage(null)
          setText(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Que el Enter del lector no envíe el formulario ni cierre nada.
            e.preventDefault()
            void onEnter()
          }
        }}
      />
      {scanMessage && (
        <p className={styles.optionError} role="alert">
          {scanMessage}
        </p>
      )}
      <ul id={listId} className={styles.options} aria-label="Productos encontrados">
        {query.isPending && <li className={styles.muted}>Buscando…</li>}
        {query.error && <li className={styles.optionError}>{toAppError(query.error).message}</li>}
        {query.data?.length === 0 && (
          <li className={styles.muted}>
            {includeInactive ? 'No hay productos con ese texto.' : 'No hay productos activos con ese texto.'}
          </li>
        )}
        {query.data?.map((p) => (
          <li key={p.id}>
            <button type="button" className={styles.option} onClick={() => choose(p)}>
              <span>
                {p.name}
                {!p.is_active && <span className={styles.muted}> (inactivo)</span>}
              </span>
              <span className={styles.muted}>SKU {p.sku}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
