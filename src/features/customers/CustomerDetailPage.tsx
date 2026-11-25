import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { formatDateTime } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import { usePermissions } from '../auth/useProfile'
import { CustomerFormDialog } from './CustomerFormDialog'
import { CustomerPaymentDialog } from './CustomerPaymentDialog'
import { CustomerStatus } from './CustomersPage'
import {
  authorizeOverLimit,
  CUSTOMERS_KEY,
  fetchAccountMovements,
  fetchCustomer,
  voidCustomerPayment,
  type AccountMovement,
} from './customers-api'
import styles from './Customers.module.css'

type ColumnKey = 'date' | 'detail' | 'charge' | 'payment' | 'actions'

export function CustomerDetailPage() {
  const { id = '' } = useParams()
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const canManage = usePermissions().manageCustomers
  const customer = useQuery({ queryKey: [...CUSTOMERS_KEY, id], queryFn: () => fetchCustomer(client, id) })
  const movements = useQuery({ queryKey: [...CUSTOMERS_KEY, id, 'movements'], queryFn: () => fetchAccountMovements(client, id) })
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [voiding, setVoiding] = useState<AccountMovement | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY })

  const authorize = useMutation({
    mutationFn: () => authorizeOverLimit(client, id),
    onSuccess: async () => {
      await refresh()
      toast.success('Autorizado: la próxima venta a cuenta de este cliente puede pasar el límite (30 minutos).')
    },
    onError: (e) => toast.error(toAppError(e).message),
  })

  const voidPayment = useMutation({
    mutationFn: (m: AccountMovement) => voidCustomerPayment(client, m.movement_id, voidReason),
    onSuccess: async () => {
      await refresh()
      setVoiding(null)
      setVoidReason('')
      toast.success('Pago anulado: el importe vuelve a la deuda.')
    },
    onError: (e) => toast.error(toAppError(e).message),
  })

  if (customer.isPending) return <LoadingState />
  if (customer.error) return <ErrorState message={toAppError(customer.error).message} onRetry={() => void customer.refetch()} />
  const c = customer.data
  // La vigencia la controla la base; acá solo se muestra hasta cuándo vale (se refresca al cargar).
  const authorizedUntil = c.over_limit_authorized_until !== null

  const columns: Column<AccountMovement, ColumnKey>[] = [
    { key: 'date', header: 'Fecha', render: (m) => formatDateTime(m.created_at) },
    {
      key: 'detail',
      header: 'Detalle',
      render: (m) => (
        <span className={styles.stack}>
          <span className={m.voided_at ? styles.voided : undefined}>
            {m.kind === 'charge' ? `Compra (venta n.º ${m.sale_number})` : `Pago · ${m.payment_method_name}`}
            {m.reference ? ` · ${m.reference}` : ''}
          </span>
          {m.over_limit && <span className={styles.muted}>Autorizada por encima del límite</span>}
          {m.voided_at && (
            <Badge tone="danger">{m.kind === 'charge' ? 'Venta anulada' : `Anulado: ${m.void_reason ?? ''}`}</Badge>
          )}
        </span>
      ),
    },
    { key: 'charge', header: 'Debe', align: 'end', render: (m) => (m.kind === 'charge' ? formatMoney(m.amount) : '') },
    { key: 'payment', header: 'Pagó', align: 'end', render: (m) => (m.kind === 'payment' ? formatMoney(m.amount) : '') },
    {
      key: 'actions',
      header: 'Acciones',
      render: (m) =>
        canManage && m.kind === 'payment' && !m.voided_at ? (
          <Button size="sm" variant="ghost" onClick={() => setVoiding(m)}>
            Anular pago
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title={c.name}
        description={[c.document_number && `DNI/CUIT ${c.document_number}`, c.phone, c.address].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link to="/clientes">Volver a clientes</Link>
            {c.balance > 0 && (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Cobrar deuda
              </Button>
            )}
            {canManage && (
              <>
                <Button onClick={() => setEditing(true)}>Editar</Button>
                <Button loading={authorize.isPending} disabled={!c.is_active || c.is_blocked} onClick={() => authorize.mutate()}>
                  Autorizar pasar el límite
                </Button>
              </>
            )}
          </>
        }
      />
      <dl className={styles.summary}>
        <div>
          <dt>Debe</dt>
          <dd>{formatMoney(c.balance)}</dd>
        </div>
        <div>
          <dt>Límite</dt>
          <dd>{formatMoney(c.credit_limit)}</dd>
        </div>
        <div>
          <dt>Disponible</dt>
          <dd>{formatMoney(c.available_credit)}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>
            <CustomerStatus c={c} />
          </dd>
        </div>
      </dl>
      {c.is_blocked && c.blocked_reason && <p>Motivo del bloqueo: {c.blocked_reason}</p>}
      {authorizedUntil && (
        <p role="status">
          <Badge tone="warning">Exceso autorizado</Badge> La próxima venta a cuenta puede pasar el límite hasta las{' '}
          {formatDateTime(c.over_limit_authorized_until)}.
        </p>
      )}
      {c.notes && <p className={styles.muted}>{c.notes}</p>}

      <h2>Estado de cuenta</h2>
      <DataTable
        caption="Compras y pagos de la cuenta corriente"
        columns={columns}
        rows={movements.data ?? []}
        rowKey={(m) => `${m.kind}-${m.movement_id}`}
        isLoading={movements.isPending}
        errorMessage={movements.error ? toAppError(movements.error).message : null}
        onRetry={() => void movements.refetch()}
        emptyTitle="Sin movimientos"
        emptyDescription="Las compras a cuenta corriente y los pagos aparecen acá."
      />

      {editing && <CustomerFormDialog customer={c} onClose={() => setEditing(false)} />}
      {paying && <CustomerPaymentDialog customer={c} onClose={() => setPaying(false)} />}
      <ConfirmDialog
        open={voiding !== null}
        title="Anular pago"
        confirmLabel="Anular pago"
        tone="danger"
        busy={voidPayment.isPending}
        onConfirm={() => voiding && voidReason.trim() !== '' && voidPayment.mutate(voiding)}
        onCancel={() => {
          setVoiding(null)
          setVoidReason('')
        }}
      >
        <p>
          El pago de {formatMoney(voiding?.amount ?? 0)} vuelve a la deuda. Solo se puede mientras la caja donde se cobró siga
          abierta.
        </p>
        <label htmlFor="void-reason">Motivo</label>
        <input id="void-reason" className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </ConfirmDialog>
    </>
  )
}
