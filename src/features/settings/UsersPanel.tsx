import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { APP_ROLES, ROLE_LABEL, type AppRole } from '../../domain/roles'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import { useProfile } from '../auth/useProfile'
import { listUsers, updateUser, validateFullName, type UserRow } from './users-api'
import styles from './Settings.module.css'

type ColumnKey = 'name' | 'role' | 'status' | 'actions'

const ROLE_HELP: Record<AppRole, string> = {
  admin: 'Todo, más usuarios y auditoría.',
  manager: 'Productos, precios, catálogos, todos los movimientos, anulaciones, dashboard y alertas.',
  staff: 'Consulta todo, registra ingresos y consumo interno, y actualiza cajas.',
}

/** Usuarios: rol y estado. Solo el dueño (§5.1, §9); la base vuelve a controlarlo. */
export function UsersPanel() {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const me = useProfile().data?.id
  const query = useQuery({ queryKey: ['users'], queryFn: () => listUsers(client) })
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [toggling, setToggling] = useState<UserRow | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const toggle = useMutation({
    mutationFn: (u: UserRow) => updateUser(client, u.id, { is_active: !u.is_active }),
    onSuccess: async (u) => {
      setToggling(null)
      await refresh()
      toast.success(`${u.full_name} ${u.is_active ? 'puede volver a operar' : 'quedó desactivado'}.`)
    },
    onError: (e) => {
      setToggling(null)
      toast.error(toAppError(e).message)
    },
  })

  const columns: Column<UserRow, ColumnKey>[] = [
    {
      key: 'name',
      header: 'Nombre',
      minWidth: '12rem',
      render: (u) => (
        <>
          {u.full_name}
          {u.id === me && <span className={styles.muted}> (vos)</span>}
        </>
      ),
    },
    { key: 'role', header: 'Rol', render: (u) => ROLE_LABEL[u.role] },
    {
      key: 'status',
      header: 'Estado',
      render: (u) => (u.is_active ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral">Desactivado</Badge>),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (u) =>
        u.id === me ? (
          <span className={styles.muted}>Tu propio usuario no se edita acá</span>
        ) : (
          <div className={styles.rowActions}>
            <Button size="sm" onClick={() => setEditing(u)} aria-label={`Editar ${u.full_name}`}>
              Editar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setToggling(u)}
              aria-label={`${u.is_active ? 'Desactivar' : 'Activar'} a ${u.full_name}`}
            >
              {u.is_active ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        ),
    },
  ]

  return (
    <section className={styles.section} aria-labelledby="users-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="users-title">Usuarios</h2>
          <p className={styles.help}>
            Las cuentas nuevas se crean desde el panel de Supabase (Authentication) y entran como Empleado; acá se les
            asigna el rol. Para dar de baja a alguien, desactivalo: su historial se conserva.
          </p>
        </div>
      </div>

      <DataTable
        caption="Usuarios del sistema"
        columns={columns}
        rows={query.data ?? []}
        rowKey={(u) => u.id}
        isLoading={query.isPending}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No hay usuarios"
      />

      <UserDialog
        key={editing?.id ?? 'closed'}
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={async (u) => {
          setEditing(null)
          await refresh()
          toast.success(`Se guardaron los cambios de ${u.full_name}.`)
        }}
      />

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.is_active ? 'Desactivar usuario' : 'Activar usuario'}
        confirmLabel={toggling?.is_active ? 'Desactivar' : 'Activar'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        busy={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onCancel={() => setToggling(null)}
      >
        {toggling?.is_active ? (
          <p>
            <strong>{toggling.full_name}</strong> no va a poder operar ni ver datos del negocio. Sus movimientos quedan en
            el historial. Se puede volver a activar.
          </p>
        ) : (
          <p>
            <strong>{toggling?.full_name}</strong> vuelve a poder operar como {toggling ? ROLE_LABEL[toggling.role] : ''}.
          </p>
        )}
      </ConfirmDialog>
    </section>
  )
}

function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow | null
  onClose: () => void
  onSaved: (u: UserRow) => Promise<void>
}) {
  const client = useSupabase()
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [role, setRole] = useState<AppRole>(user?.role ?? 'staff')
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => updateUser(client, user?.id ?? '', { full_name: fullName.trim(), role }),
    onSuccess: (u) => onSaved(u),
    onError: (e) => setServerError(toAppError(e).message),
  })

  if (!user) return null

  function submit() {
    setServerError(null)
    const e = validateFullName(fullName)
    setError(e)
    if (!e) save.mutate()
  }

  return (
    <Modal
      open
      title={`Editar usuario: ${user.full_name}`}
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
        <FormField label="Nombre" htmlFor="user-full_name" required error={error}>
          <input
            id="user-full_name"
            className="input"
            autoComplete="off"
            maxLength={120}
            aria-invalid={error ? true : undefined}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </FormField>
        <fieldset className={styles.roles}>
          <legend>Rol</legend>
          {APP_ROLES.map((r) => (
            <label key={r} className={styles.roleOption}>
              <input type="radio" name="user-role" value={r} checked={role === r} onChange={() => setRole(r)} />
              {ROLE_LABEL[r]}
              <span className={styles.muted}>— {ROLE_HELP[r]}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  )
}
