import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { EXPIRY_STATUS_LABEL } from '../../domain/expiry'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { listCatalog } from '../catalogs/api'
import {
  createAlertSetting,
  daysToForm,
  deleteAlertSetting,
  listAlertSettings,
  updateAlertSetting,
  validateAlertDays,
  type AlertDaysErrors,
  type AlertDaysValues,
  type AlertSettingRow,
} from './alert-settings-api'
import styles from './Settings.module.css'

type ColumnKey = 'scope' | 'urgent' | 'soon' | 'notice' | 'actions'

interface Row extends AlertSettingRow {
  label: string
}

/** Días de alerta de vencimiento: una configuración general y excepciones por categoría (contrato §5.9). */
export function AlertSettingsPanel() {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const settings = useQuery({ queryKey: ['alert-settings'], queryFn: () => listAlertSettings(client) })
  const categories = useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => listCatalog(client, 'categories') })

  const [editing, setEditing] = useState<{ row: Row | null } | null>(null)
  const [removing, setRemoving] = useState<Row | null>(null)

  const nameOf = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
  const rows: Row[] = (settings.data ?? [])
    .map((r) => ({ ...r, label: r.category_id ? (nameOf.get(r.category_id) ?? 'Categoría') : 'General (todas las categorías)' }))
    .sort((a, b) => (a.category_id === null ? -1 : b.category_id === null ? 1 : a.label.localeCompare(b.label, 'es')))
  const usedCategories = new Set(rows.map((r) => r.category_id))
  const freeCategories = (categories.data ?? []).filter((c) => c.is_active && !usedCategories.has(c.id))

  // Las alertas, la ficha y el dashboard dependen de estos días: se recalculan en la base.
  const refresh = () =>
    Promise.all(
      ['alert-settings', 'alerts', 'products', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )

  const remove = useMutation({
    mutationFn: (row: Row) => deleteAlertSetting(client, row.id),
    onSuccess: async (_, row) => {
      setRemoving(null)
      await refresh()
      toast.success(`"${row.label}" vuelve a usar la configuración general.`)
    },
    onError: (e) => {
      setRemoving(null)
      toast.error(toAppError(e).message)
    },
  })

  const columns: Column<Row, ColumnKey>[] = [
    { key: 'scope', header: 'Aplica a', render: (r) => (r.category_id ? r.label : <strong>{r.label}</strong>), minWidth: '14rem' },
    { key: 'urgent', header: EXPIRY_STATUS_LABEL.expires_urgent, align: 'end', render: (r) => `${r.urgent_days} días` },
    { key: 'soon', header: EXPIRY_STATUS_LABEL.expires_soon, align: 'end', render: (r) => `${r.soon_days} días` },
    { key: 'notice', header: EXPIRY_STATUS_LABEL.expires_upcoming, align: 'end', render: (r) => `${r.notice_days} días` },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (r) => (
        <div className={styles.rowActions}>
          <Button size="sm" onClick={() => setEditing({ row: r })} aria-label={`Editar días de ${r.label}`}>
            Editar
          </Button>
          {r.category_id && (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`Quitar la excepción de ${r.label}`}>
              Quitar
            </Button>
          )}
        </div>
      ),
    },
  ]

  const loadError = settings.error ?? categories.error
  const general = rows.find((r) => r.category_id === null) ?? null

  return (
    <section className={styles.section} aria-labelledby="alert-settings-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="alert-settings-title">Alertas de vencimiento</h2>
          <p className={styles.help}>
            Cuántos días antes del vencimiento se avisa. La configuración general vale para todas las categorías; si una
            necesita otros días (por ejemplo, limpieza vence en años), agregale una excepción.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setEditing({ row: null })}
          disabled={freeCategories.length === 0 || settings.isPending}
        >
          + Excepción por categoría
        </Button>
      </div>

      <DataTable
        caption="Días de alerta por categoría"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={settings.isPending || categories.isPending}
        errorMessage={loadError ? toAppError(loadError).message : null}
        onRetry={() => void Promise.all([settings.refetch(), categories.refetch()])}
        emptyTitle="Todavía no hay configuración de alertas"
      />

      <AlertDaysDialog
        key={editing ? (editing.row?.id ?? 'new') : 'closed'}
        open={editing !== null}
        row={editing?.row ?? null}
        defaults={general}
        categories={freeCategories}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null)
          await refresh()
          toast.success(message)
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Quitar excepción"
        confirmLabel="Quitar"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      >
        <p>
          <strong>{removing?.label}</strong> va a usar la configuración general
          {general ? ` (${general.urgent_days} / ${general.soon_days} / ${general.notice_days} días)` : ''}. Queda
          registrado quién lo quitó.
        </p>
      </ConfirmDialog>
    </section>
  )
}

interface AlertDaysDialogProps {
  open: boolean
  /** `null` = nueva excepción. */
  row: Row | null
  defaults: AlertSettingRow | null
  categories: { id: string; name: string }[]
  onClose: () => void
  onSaved: (message: string) => Promise<void>
}

function AlertDaysDialog({ open, row, defaults, categories, onClose, onSaved }: AlertDaysDialogProps) {
  const client = useSupabase()
  const [categoryId, setCategoryId] = useState('')
  const [values, setValues] = useState<AlertDaysValues>(() =>
    daysToForm(row ?? defaults ?? { urgent_days: 7, soon_days: 15, notice_days: 30 }),
  )
  const [errors, setErrors] = useState<AlertDaysErrors & { category?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (days: { urgent_days: number; soon_days: number; notice_days: number }) =>
      row ? updateAlertSetting(client, row.id, days) : createAlertSetting(client, categoryId, days),
    onSuccess: () =>
      onSaved(
        row
          ? `Se guardaron los días de "${row.label}".`
          : `"${categories.find((c) => c.id === categoryId)?.name ?? 'La categoría'}" tiene ahora sus propios días.`,
      ),
    onError: (e) => setServerError(toAppError(e).message),
  })

  if (!open) return null

  function submit() {
    setServerError(null)
    const { errors: next, days } = validateAlertDays(values)
    const all = !row && categoryId === '' ? { ...next, category: 'Elegí la categoría.' } : next
    setErrors(all)
    if (days && Object.keys(all).length === 0) save.mutate(days)
  }

  const field = (key: keyof AlertDaysValues, label: string, hint: string) => (
    <FormField label={label} htmlFor={`alert-${key}`} required error={errors[key]} hint={hint}>
      <input
        id={`alert-${key}`}
        className="input"
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={errors[key] ? true : undefined}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
    </FormField>
  )

  return (
    <Modal
      open
      title={row ? `Días de alerta: ${row.label}` : 'Nueva excepción por categoría'}
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Guardar
          </Button>
        </>
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      <div className={styles.form}>
        {!row && (
          <FormField label="Categoría" htmlFor="alert-category" required error={errors.category}>
            <select
              id="alert-category"
              className="select"
              aria-invalid={errors.category ? true : undefined}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Elegí una categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
        {field('urgent_days', EXPIRY_STATUS_LABEL.expires_urgent, 'Días antes del vencimiento en que pasa a urgente.')}
        {field('soon_days', EXPIRY_STATUS_LABEL.expires_soon, 'Igual o mayor que "urgente".')}
        {field('notice_days', EXPIRY_STATUS_LABEL.expires_upcoming, 'Desde cuántos días antes se empieza a avisar (máximo 365).')}
      </div>
    </Modal>
  )
}
