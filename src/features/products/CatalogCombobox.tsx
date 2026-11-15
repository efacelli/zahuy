import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useController, type Control, type FieldPath } from 'react-hook-form'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { describedBy } from '../../components/ui/form-field-ids'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { createCatalogItem } from '../catalogs/api'
import type { CatalogTable } from './api'
import { exactMatch, filterOptions, type Option } from './catalog-search'
import type { ProductFormOutput, ProductFormValues } from './product-form-schema'
import { catalogQueryKey, useCatalogOptions } from './useCatalogOptions'
import styles from './CatalogCombobox.module.css'

const NOUN: Record<CatalogTable, string> = { categories: 'categoría', brands: 'marca', suppliers: 'proveedor' }

interface CatalogComboboxProps {
  id: string
  label: string
  table: CatalogTable
  name: FieldPath<ProductFormValues>
  control: Control<ProductFormValues, unknown, ProductFormOutput>
  required: boolean
  error?: string
  /** Encargado y dueño pueden crear la opción si no existe (los catálogos son suyos, §9). */
  canCreate: boolean
}

type Item = { kind: 'option'; option: Option } | { kind: 'create'; text: string }

/**
 * Campo con autocompletado sobre un catálogo (patrón combobox de ARIA):
 * se escribe, se filtra al instante, flechas + Enter para elegir, y si no
 * existe se puede crear ahí mismo.
 */
export function CatalogCombobox({ id, label, table, name, control, required, error, canCreate }: CatalogComboboxProps) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const listId = useId()
  const query = useCatalogOptions(table)
  const options: Option[] = query.data ?? []
  const { field } = useController({ name, control })
  const selected = options.find((o) => o.id === field.value)

  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const shown = text ?? selected?.name ?? ''
  const matches = filterOptions(options, text ?? '')
  const typed = (text ?? '').trim()
  const items: Item[] = [
    ...matches.map((option) => ({ kind: 'option' as const, option })),
    ...(canCreate && typed !== '' && !exactMatch(options, typed) ? [{ kind: 'create' as const, text: typed }] : []),
  ]

  function choose(option: Option) {
    field.onChange(option.id)
    setText(null)
    setOpen(false)
    setCreateError(null)
  }

  async function create(newName: string) {
    setCreating(true)
    setCreateError(null)
    try {
      const row = await createCatalogItem(client, table, { name: newName })
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey(table) })
      await queryClient.invalidateQueries({ queryKey: ['catalog', table] })
      choose({ id: row.id, name: row.name })
    } catch (e) {
      setCreateError(toAppError(e).message)
    } finally {
      setCreating(false)
    }
  }

  function pick(item: Item | undefined) {
    if (!item) return
    if (item.kind === 'option') choose(item.option)
    else void create(item.text)
  }

  function onBlur() {
    field.onBlur()
    setOpen(false)
    if (text === null) return
    // Al salir: si lo escrito coincide con una opción, queda elegida; vacío = sin valor.
    const exact = exactMatch(options, text)
    if (exact) choose(exact)
    else if (text.trim() === '') {
      field.onChange('')
      setText(null)
    }
  }

  const pendingText = text !== null && text.trim() !== '' && !exactMatch(options, text)
  const shownError =
    createError ??
    error ??
    (pendingText && !open ? `"${text?.trim()}" no está en la lista: elegí una opción${canCreate ? ' o creala' : ''}.` : undefined)
  const loadError = query.error ? toAppError(query.error).message : null
  const hint = loadError ?? (query.isPending ? 'Cargando…' : options.length === 0 ? 'Todavía no hay opciones.' : undefined)

  return (
    <FormField label={label} htmlFor={id} required={required} error={shownError} hint={hint}>
      <div className={styles.wrap}>
        <input
          id={id}
          className="input"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy(id, { hint, error: shownError })}
          placeholder={required ? 'Escribí para buscar' : 'Opcional: escribí para buscar'}
          value={shown}
          disabled={creating || !!loadError}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setOpen(true)
            setCreateError(null)
          }}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(a + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              // Enter elige; nunca envía el formulario desde acá.
              e.preventDefault()
              if (open) pick(items[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
              setText(null)
            }
          }}
        />
        {loadError && (
          <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            Reintentar
          </Button>
        )}
        {open && items.length > 0 && (
          <div id={listId} role="listbox" className={styles.list} aria-label={`Opciones de ${label.toLowerCase()}`}>
            {items.map((item, i) => (
              <div
                key={item.kind === 'option' ? item.option.id : 'create'}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={`${styles.item} ${i === active ? styles.active : ''} ${item.kind === 'create' ? styles.create : ''}`}
                // mousedown en lugar de click: se ejecuta antes del blur del input.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(item)
                }}
                onMouseEnter={() => setActive(i)}
              >
                {item.kind === 'option' ? item.option.name : `+ Crear ${NOUN[table]} "${item.text}"`}
              </div>
            ))}
          </div>
        )}
      </div>
    </FormField>
  )
}
