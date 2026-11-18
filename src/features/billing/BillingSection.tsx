import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/toast-context'
import { formatDate } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useSupabase } from '../../lib/supabase-context'
import {
  CBTE_LABEL,
  DOC_TYPES,
  FISCAL_STATUS_LABEL,
  VAT_CONDITIONS,
  emitFiscalDocument,
  fetchFiscalSettings,
  fetchSaleDocuments,
  fiscalMessage,
  formatCbteNumber,
  EMPTY_RECEIVER,
  receiverError,
  type EmitOutcome,
  type EmitRequest,
  type FiscalDocumentRow,
  type ReceiverForm,
} from './billing-api'
import styles from './Billing.module.css'

const SETTINGS_KEY = ['fiscal-settings'] as const
const documentsKey = (saleId: string) => ['fiscal-documents', saleId] as const

const LIVE: FiscalDocumentRow['status'][] = ['authorized', 'pending', 'unknown']

/**
 * Facturación electrónica de una venta, dentro de su detalle (contrato §22). Solo aparece si la base la tiene
 * y está activada (ambiente distinto de «off») o si la venta ya tiene comprobantes.
 */
export function BillingSection({ saleId, saleStatus }: { saleId: string; saleStatus: 'completed' | 'voided' }) {
  const client = useSupabase()
  const toast = useToast()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => fetchFiscalSettings(client), staleTime: 60_000 })
  const documents = useQuery({ queryKey: documentsKey(saleId), queryFn: () => fetchSaleDocuments(client, saleId) })

  /** Qué formulario está abierto; la clave se genera al abrirlo para que un reintento no duplique el comprobante. */
  const [open, setOpen] = useState<{ action: EmitRequest['action']; key: string } | null>(null)
  const [receiver, setReceiver] = useState<ReceiverForm>(EMPTY_RECEIVER)
  const [formError, setFormError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const emit = useMutation({
    mutationFn: (request: EmitRequest) => emitFiscalDocument(client, request),
    onSuccess: async (outcome: EmitOutcome, request) => {
      await queryClient.invalidateQueries({ queryKey: documentsKey(saleId) })
      const what = request.action === 'credit_note' ? 'La nota de crédito' : 'La factura'
      if (outcome.ok) {
        toast.success(`${what} quedó autorizada por ARCA.`)
        setOpen(null)
        setMessage(null)
      } else if (outcome.inProgress) {
        setOpen(null)
        setMessage({
          tone: 'info',
          text: outcome.reconcile
            ? 'ARCA y Zahuy tienen importes distintos para este comprobante: avisá al administrador.'
            : `${what} todavía no está confirmada por ARCA. Esperá unos segundos y tocá «Consultar estado».`,
        })
      } else if (outcome.status === 'rejected') {
        setOpen(null)
        setMessage({ tone: 'error', text: `ARCA rechazó ${what.toLowerCase()}. Podés volver a intentarlo.` })
      } else {
        setMessage({ tone: 'error', text: fiscalMessage(outcome.code) })
      }
    },
    onError: (e) => setMessage({ tone: 'error', text: toAppError(e).message }),
  })

  if (!settings.data) return null
  const rows = documents.data ?? []
  if (settings.data.environment === 'off' && rows.length === 0) return null

  const live = rows.find((d) => d.kind === 'invoice' && LIVE.includes(d.status))
  const credit = rows.find((d) => d.kind === 'credit_note' && LIVE.includes(d.status))
  const canInvoice = settings.data.environment !== 'off' && saleStatus === 'completed' && !live
  const canCredit = live?.status === 'authorized' && !credit
  const pendingOne = live && live.status !== 'authorized' ? live : credit && credit.status !== 'authorized' ? credit : null

  function openForm(action: EmitRequest['action']) {
    setMessage(null)
    setFormError(null)
    setReceiver(EMPTY_RECEIVER)
    setOpen({ action, key: newIdempotencyKey() })
  }

  function submit() {
    if (!open) return
    const invalid = open.action === 'invoice' ? receiverError(receiver) : null
    setFormError(invalid)
    if (invalid) return
    const request: EmitRequest = { action: open.action, sale_id: saleId, idempotency_key: open.key }
    if (open.action === 'invoice' && receiver.identify) {
      request.receiver = { docType: receiver.docType, docNumber: receiver.docNumber.trim(), vatConditionId: receiver.vatConditionId }
    }
    setMessage(null)
    emit.mutate(request)
  }

  return (
    <section className={styles.section} aria-label="Facturación electrónica">
      <h3 className={styles.heading}>
        Facturación electrónica
        {settings.data.environment === 'homologacion' && (
          <span className={styles.test}>Ambiente de prueba: sin validez fiscal</span>
        )}
      </h3>

      {message && (
        <p className={message.tone === 'error' ? styles.error : styles.info} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.tone === 'error' && <Icon name="error" size={18} />} {message.text}
        </p>
      )}

      {rows.length > 0 && (
        <ul className={styles.list} aria-label="Comprobantes de la venta">
          {rows.map((d) => (
            <li key={d.id} className={styles.doc}>
              <span>
                <strong>{CBTE_LABEL[d.cbte_tipo] ?? `Comprobante ${d.cbte_tipo}`}</strong> {formatCbteNumber(d.pto_vta, d.cbte_nro)}
                {' · '}
                {FISCAL_STATUS_LABEL[d.status]}
              </span>
              <span>{formatMoney(d.imp_total)}</span>
              {d.status === 'authorized' && d.cae && (
                <span className={styles.docMeta}>
                  CAE {d.cae}
                  {d.cae_expires_on ? ` · vence ${formatDate(d.cae_expires_on)}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open && (
        <div className={styles.actions}>
          {canInvoice && <Button onClick={() => openForm('invoice')}>Facturar…</Button>}
          {canCredit && <Button onClick={() => openForm('credit_note')}>Nota de crédito…</Button>}
          {pendingOne && (
            <Button
              loading={emit.isPending}
              onClick={() => emit.mutate({ action: pendingOne.kind, sale_id: saleId, idempotency_key: newIdempotencyKey() })}
            >
              Consultar estado
            </Button>
          )}
        </div>
      )}

      {open?.action === 'invoice' && (
        <div className={styles.form}>
          <label>
            <input type="checkbox" checked={receiver.identify} onChange={(e) => setReceiver({ ...receiver, identify: e.target.checked })} />{' '}
            Identificar al cliente (si no, sale a consumidor final)
          </label>
          {receiver.identify && (
            <div className={styles.fields}>
              <FormField label="Condición frente al IVA" htmlFor="bill-vat">
                <select
                  id="bill-vat"
                  className="select"
                  value={receiver.vatConditionId}
                  onChange={(e) => setReceiver({ ...receiver, vatConditionId: Number(e.target.value) })}
                >
                  {VAT_CONDITIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} (Factura {c.factura})
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Tipo de documento" htmlFor="bill-doctype">
                <select
                  id="bill-doctype"
                  className="select"
                  value={receiver.docType}
                  onChange={(e) => setReceiver({ ...receiver, docType: Number(e.target.value) })}
                >
                  <option value={DOC_TYPES.CUIT}>CUIT</option>
                  <option value={DOC_TYPES.DNI}>DNI</option>
                </select>
              </FormField>
              <FormField label="Número" htmlFor="bill-docnumber" error={formError}>
                <input
                  id="bill-docnumber"
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={formError ? true : undefined}
                  value={receiver.docNumber}
                  onChange={(e) => setReceiver({ ...receiver, docNumber: e.target.value })}
                />
              </FormField>
            </div>
          )}
          <div className={styles.actions}>
            <Button onClick={() => setOpen(null)} disabled={emit.isPending}>
              Volver
            </Button>
            <Button variant="primary" loading={emit.isPending} onClick={submit}>
              Emitir factura
            </Button>
          </div>
        </div>
      )}

      {open?.action === 'credit_note' && (
        <div className={styles.form}>
          <p className={styles.info}>
            Se emite una nota de crédito por el total de la factura. Después de autorizada, la venta se puede anular.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => setOpen(null)} disabled={emit.isPending}>
              Volver
            </Button>
            <Button variant="danger" loading={emit.isPending} onClick={submit}>
              Emitir nota de crédito
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
