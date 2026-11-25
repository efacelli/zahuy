import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { formatDate } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { CustomerFormDialog } from './CustomerFormDialog'
import { CUSTOMERS_KEY, fetchCustomers, type CustomerBalance } from './customers-api'
import styles from './Customers.module.css'

type ColumnKey = 'name' | 'doc' | 'phone' | 'balance' | 'limit' | 'available' | 'last' | 'status'

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function CustomerStatus({ c }: { c: CustomerBalance }) {
  if (!c.is_active) return <Badge tone="neutral">Inactivo</Badge>
  if (c.is_blocked) return <Badge tone="danger">Bloqueado</Badge>
  if (c.balance > c.credit_limit) return <Badge tone="warning">Pasado del límite</Badge>
  return <Badge tone="success">Habilitado</Badge>
}

export function CustomersPage() {
  const client = useSupabase()
  const canManage = usePermissions().manageCustomers
  const [search, setSearch] = useState('')
  const [onlyDebt, setOnlyDebt] = useState(false)
  const [creating, setCreating] = useState(false)
  const query = useQuery({ queryKey: CUSTOMERS_KEY, queryFn: () => fetchCustomers(client) })

  const q = normalize(search.trim())
  const rows = (query.data ?? []).filter(
    (c) =>
      (!onlyDebt || c.balance > 0) &&
      (q === '' || normalize(c.name).includes(q) || (c.document_number ?? '').includes(q) || (c.phone ?? '').includes(q)),
  )
  const totalDebt = (query.data ?? []).reduce((sum, c) => sum + Math.max(c.balance, 0), 0)

  const columns: Column<CustomerBalance, ColumnKey>[] = [
    { key: 'name', header: 'Cliente', render: (c) => <Link to={`/clientes/${c.customer_id}`}>{c.name}</Link> },
    { key: 'doc', header: 'DNI / CUIT', render: (c) => c.document_number ?? '—' },
    { key: 'phone', header: 'Teléfono', render: (c) => c.phone ?? '—' },
    { key: 'balance', header: 'Debe', align: 'end', render: (c) => <span className={styles.debt}>{formatMoney(c.balance)}</span> },
    { key: 'limit', header: 'Límite', align: 'end', render: (c) => formatMoney(c.credit_limit) },
    { key: 'available', header: 'Disponible', align: 'end', render: (c) => formatMoney(c.available_credit) },
    {
      key: 'last',
      header: 'Último pago',
      render: (c) => (c.last_payment_at ? formatDate(c.last_payment_at.slice(0, 10)) : 'Nunca'),
    },
    { key: 'status', header: 'Estado', render: (c) => <CustomerStatus c={c} /> },
  ]

  return (
    <>
      <PageHeader
        title="Clientes"
        description={`Cuentas corrientes. Deuda total: ${formatMoney(totalDebt)}.`}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Nuevo cliente
            </Button>
          )
        }
      />
      <div className={styles.toolbar}>
        <input
          className="input"
          type="search"
          aria-label="Buscar cliente"
          placeholder="Buscar por nombre, DNI o teléfono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} />
          Solo con deuda
        </label>
      </div>
      <DataTable
        caption="Clientes con cuenta corriente"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.customer_id}
        isLoading={query.isPending}
        errorMessage={query.error ? toAppError(query.error).message : null}
        onRetry={() => void query.refetch()}
        emptyTitle={search || onlyDebt ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}
        emptyDescription={canManage && !search && !onlyDebt ? 'Creá el primero con «Nuevo cliente».' : undefined}
      />
      {creating && <CustomerFormDialog customer={null} onClose={() => setCreating(false)} />}
    </>
  )
}
