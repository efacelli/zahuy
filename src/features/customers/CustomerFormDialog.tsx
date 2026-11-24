import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { createCustomer, CUSTOMERS_KEY, updateCustomer, type CustomerBalance, type CustomerInput } from './customers-api'
import styles from './Customers.module.css'

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** Alta y edición de un cliente (encargado y dueño, §23.2). */
export function CustomerFormDialog({ customer, onClose }: { customer: CustomerBalance | null; onClose: () => void }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(customer?.name ?? '')
  const [doc, setDoc] = useState(customer?.document_number ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [address, setAddress] = useState(customer?.address ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [limit, setLimit] = useState(customer ? String(customer.credit_limit).replace('.', ',') : '')
  const [blocked, setBlocked] = useState(customer?.is_blocked ?? false)
  const [blockedReason, setBlockedReason] = useState(customer?.blocked_reason ?? '')
  const [active, setActive] = useState(customer?.is_active ?? true)
  const [showErrors, setShowErrors] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const limitValue = parseDecimalInput(limit)
  const docClean = doc.replace(/\D/g, '')
  const errors = {
    name: name.trim() === '' ? 'Escribí el nombre.' : null,
    doc: doc.trim() !== '' && !/^[0-9]{7,11}$/.test(docClean) ? 'DNI o CUIT: de 7 a 11 dígitos.' : null,
    limit: limitValue === null || limitValue < 0 ? 'Indicá el límite (0 o más).' : null,
  }

  const save = useMutation({
    mutationFn: (input: CustomerInput) =>
      customer ? updateCustomer(client, customer.customer_id, input) : createCustomer(client, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY })
      toast.success(customer ? 'Cliente actualizado.' : 'Cliente creado.')
      onClose()
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function submit() {
    setShowErrors(true)
    setServerError(null)
    if (errors.name || errors.doc || errors.limit) return
    save.mutate({
      name: name.trim(),
      document_number: orNull(docClean),
      phone: orNull(phone),
      address: orNull(address),
      notes: orNull(notes),
      credit_limit: Math.round((limitValue ?? 0) * 100) / 100,
      is_blocked: blocked,
      blocked_reason: blocked ? orNull(blockedReason) : null,
      is_active: active,
    })
  }

  return (
    <Modal
      open
      title={customer ? `Editar ${customer.name}` : 'Nuevo cliente'}
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
        <p className={styles.error} role="alert">
          {serverError}
        </p>
      )}
      <div className={styles.form}>
        <FormField label="Nombre" htmlFor="cus-name" required error={showErrors ? errors.name : null}>
          <input id="cus-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="DNI o CUIT" htmlFor="cus-doc" hint="Opcional. Solo números." error={showErrors ? errors.doc : null}>
          <input id="cus-doc" className="input" inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} />
        </FormField>
        <FormField label="Teléfono" htmlFor="cus-phone">
          <input id="cus-phone" className="input" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <FormField label="Dirección" htmlFor="cus-address">
          <input id="cus-address" className="input" maxLength={120} value={address} onChange={(e) => setAddress(e.target.value)} />
        </FormField>
        <FormField
          label="Límite de crédito"
          htmlFor="cus-limit"
          required
          hint="Deuda máxima. Para pasarlo hace falta la autorización del encargado o del dueño."
          error={showErrors ? errors.limit : null}
        >
          <input id="cus-limit" className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </FormField>
        <FormField label="Observaciones" htmlFor="cus-notes">
          <textarea id="cus-notes" className="input" maxLength={500} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <label className={styles.check}>
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
          Cuenta bloqueada (no puede comprar fiado, sí pagar)
        </label>
        {blocked && (
          <FormField label="Motivo del bloqueo" htmlFor="cus-blocked-reason">
            <input
              id="cus-blocked-reason"
              className="input"
              maxLength={200}
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
            />
          </FormField>
        )}
        {customer && (
          <label className={styles.check}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Cliente activo
          </label>
        )}
      </div>
    </Modal>
  )
}
