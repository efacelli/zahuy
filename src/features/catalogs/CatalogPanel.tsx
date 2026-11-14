import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { useToast } from '../../components/ui/toast-context'
import { formatCuit } from '../../lib/cuit'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { catalogQueryKey } from '../products/useCatalogOptions'
import { createCatalogItem, listCatalog, updateCatalogItem } from './api'
import type { CatalogInfo, CatalogRow } from './catalog-config'
import { CatalogFormModal } from './CatalogFormModal'
import styles from './Catalogs.module.css'

type ColumnKey = 'name' | 'tax_id' | 'contact' | 'status' | 'actions'

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function CatalogPanel({ info }: { info: CatalogInfo }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const queryKey = ['catalog', info.kind] as const

  const query = useQuery({ queryKey, queryFn: () => listCatalog(client, info.kind) })

  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<{ row: CatalogRow | null } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<CatalogRow | null>(null)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      // El formulario de producto usa la lista de opciones activas.
      queryClient.invalidateQueries({ queryKey: catalogQueryKey(info.kind) }),
    ])
  }

  const save = useMutation({
    mutationFn: ({ id, values }: { id: string | null; values: Record<string, unknown> }) =>
      id ? updateCatalogItem(client, info.kind, id, values) : createCatalogItem(client, info.kind, values),
    onSuccess: async (row, { id }) => {
      setEditing(null)
      await refresh()
      toast.success(`${id ? 'Se guardaron los cambios de' : 'Se creó'} "${row.name}".`)
    },
    onError: (error) => setFormError(toAppError(error).message),
  })

  const toggle = useMutation({
    mutationFn: (row: CatalogRow) => updateCatalogItem(client, info.kind, row.id, { is_active: !row.is_active }),
    onSuccess: async (row) => {
      setToggling(null)
      await refresh()
      toast.success(`"${row.name}" ahora está ${row.is_active ? 'activo' : 'inactivo'}.`)
    },
    onError: (error) => {
      setToggling(null)
      toast.error(toAppError(error).message)
    },
  })

  const rows = useMemo(() => {
    const term = normalize(search.trim())
    return (query.data ?? []).filter(
      (r) => (showInactive || r.is_active) && (term === '' || normalize(r.name).includes(term) || (r.tax_id ?? '').includes(term)),
    )
  }, [query.data, search, showInactive])

  const isSupplier = info.kind === 'suppliers'
  const columns: Column<CatalogRow, ColumnKey>[] = [
    { key: 'name', header: 'Nombre', render: (r) => r.name, minWidth: '12rem' },
    ...(isSupplier
      ? ([
          { key: 'tax_id', header: 'CUIT', render: (r) => formatCuit(r.tax_id) },
          {
            key: 'contact',
            header: 'Contacto',
            render: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '—',
          },
        ] as Column<CatalogRow, ColumnKey>[])
      : []),
    {
      key: 'status',
      header: 'Estado',
      render: (r) => (r.is_active ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral">Inactivo</Badge>),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (r) => (
        <div className={styles.rowActions}>
          <Button size="sm" onClick={() => openForm(r)} aria-label={`Editar ${r.name}`}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setToggling(r)} aria-label={`${r.is_active ? 'Desactivar' : 'Activar'} ${r.name}`}>
            {r.is_active ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      ),
    },
  ]

  function openForm(row: CatalogRow | null) {
    setFormError(null)
    setEditing({ row })
  }

  const loadError = query.error ? toAppError(query.error).message : null
  const newLabel = info.kind === 'suppliers' ? 'Nuevo proveedor' : `Nueva ${info.singular}`

  return (
    <section aria-label={info.plural}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={`input ${styles.search}`}
          placeholder={isSupplier ? 'Buscar por nombre o CUIT' : 'Buscar por nombre'}
          aria-label={`Buscar ${info.plural.toLowerCase()}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className={styles.checkbox}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inactivos
        </label>
        <Button variant="primary" onClick={() => openForm(null)} className={styles.newButton}>
          + {newLabel}
        </Button>
      </div>

      <DataTable
        caption={info.plural}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={query.isPending}
        errorMessage={loadError}
        onRetry={() => void query.refetch()}
        emptyTitle={search ? 'No hay resultados para esa búsqueda' : `Todavía no hay ${info.plural.toLowerCase()}`}
        emptyDescription={search ? undefined : `Creá ${info.article === 'la' ? 'la primera' : 'el primero'} con "${newLabel}".`}
      />

      <CatalogFormModal
        info={info}
        open={editing !== null}
        row={editing?.row ?? null}
        busy={save.isPending}
        serverError={formError}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          setFormError(null)
          save.mutate({ id: editing?.row?.id ?? null, values })
        }}
      />

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.is_active ? `Desactivar ${info.singular}` : `Activar ${info.singular}`}
        confirmLabel={toggling?.is_active ? 'Desactivar' : 'Activar'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        busy={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onCancel={() => setToggling(null)}
      >
        {toggling?.is_active ? (
          <p>
            <strong>{toggling.name}</strong> deja de aparecer al cargar productos nuevos. Los productos que ya la usan no
            cambian y se puede volver a activar cuando quieras.
          </p>
        ) : (
          <p>
            <strong>{toggling?.name}</strong> vuelve a aparecer al cargar productos.
          </p>
        )}
      </ConfirmDialog>
    </section>
  )
}
