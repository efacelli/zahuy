import qrcode from 'qrcode-generator'
import { formatDate } from '../../lib/dates'
import { formatMoney, formatNumber } from '../../lib/format'
import { pageRule, useTicketPaper } from '../pos/ticket-paper'
import { formatTaxId } from '../settings/sales-settings-api'
import posStyles from '../pos/Pos.module.css'
import {
  CBTE_LABEL,
  DOC_TYPES,
  VAT_CONDITIONS,
  arDate,
  arcaQrUrl,
  formatCbteNumber,
  issuerMissing,
  type FiscalDocumentRow,
  type FiscalSettings,
} from './billing-api'
import styles from './Billing.module.css'

export interface FiscalTicketItem {
  name: string
  quantity: number
  /** Lo cobrado por la línea, con IVA y con el descuento ya aplicado. */
  lineTotal: number
}

/** Código QR de ARCA como SVG (un solo trazado: liviano de imprimir). */
function QrCode({ text }: { text: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  return (
    <svg className={styles.qr} viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label="Código QR de ARCA" shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

const docLabel = (doc: FiscalDocumentRow) => {
  if (doc.receiver_doc_type === DOC_TYPES.NONE) return 'Consumidor final'
  const kind = doc.receiver_doc_type === DOC_TYPES.CUIT ? 'CUIT' : 'DNI'
  const condition = VAT_CONDITIONS.find((c) => c.id === doc.receiver_vat_condition_id)?.label
  return `${kind} ${doc.receiver_doc_number}${condition ? ` · ${condition}` : ''}`
}

/**
 * Comprobante fiscal para imprimir (contrato §22): datos del emisor, tipo y número, cliente, detalle, IVA, CAE y
 * código QR de ARCA. Usa el mismo papel y las mismas reglas de impresión que el ticket interno.
 */
export function FiscalTicket({
  doc,
  settings,
  items,
  invoice,
}: {
  doc: FiscalDocumentRow
  settings: FiscalSettings
  items: FiscalTicketItem[]
  /** Para una nota de crédito: la factura que anula. */
  invoice?: FiscalDocumentRow
}) {
  const [paper] = useTicketPaper()
  const missing = issuerMissing(settings)
  const qrUrl = arcaQrUrl(doc, settings.issuer_tax_id)
  const itemsTotal = items.reduce((t, i) => t + i.lineTotal, 0)
  const adjustment = Math.round((doc.imp_total - itemsTotal) * 100) / 100
  const isA = doc.cbte_tipo === 1 || doc.cbte_tipo === 3
  const isTest = doc.environment !== 'produccion'

  return (
    <div className={posStyles.ticket} data-print="ticket" data-paper={paper} aria-label="Comprobante fiscal">
      <style media="print">{pageRule(paper)}</style>
      {isTest && <p className={styles.fiscalTest}>PRUEBA · SIN VALIDEZ FISCAL</p>}
      <p className={posStyles.ticketHead}>
        <strong>{settings.issuer_name ?? 'Razón social sin cargar'}</strong>
        <br />
        {settings.issuer_address && (
          <>
            {settings.issuer_address}
            <br />
          </>
        )}
        {settings.issuer_tax_id && (
          <>
            CUIT {formatTaxId(settings.issuer_tax_id)} · IVA Responsable Inscripto
            <br />
          </>
        )}
        {settings.gross_income_number && <>Ing. Brutos {settings.gross_income_number}</>}
        {settings.gross_income_number && settings.activity_start_date && ' · '}
        {settings.activity_start_date && <>Inicio de actividades {formatDate(settings.activity_start_date)}</>}
      </p>
      {missing.length > 0 && (
        <p className={styles.fiscalWarn} role="alert">
          Faltan datos del emisor en Configuración: {missing.join(', ')}.
        </p>
      )}
      <p className={posStyles.ticketHead}>
        <strong>{(CBTE_LABEL[doc.cbte_tipo] ?? 'Comprobante').toUpperCase()}</strong> · Cód. {String(doc.cbte_tipo).padStart(3, '0')}
        <br />
        N.º {formatCbteNumber(doc.pto_vta, doc.cbte_nro)}
        <br />
        Fecha {doc.authorized_at ? formatDate(arDate(doc.authorized_at)) : '—'}
        {invoice && (
          <>
            <br />
            Anula {CBTE_LABEL[invoice.cbte_tipo] ?? 'comprobante'} {formatCbteNumber(invoice.pto_vta, invoice.cbte_nro)}
          </>
        )}
        <br />
        Cliente: {docLabel(doc)}
      </p>
      <table>
        <tbody>
          {items.map((i, n) => (
            <tr key={n}>
              <td>
                {formatNumber(i.quantity)} × {i.name}
              </td>
              <td className={posStyles.num}>{formatMoney(i.lineTotal)}</td>
            </tr>
          ))}
          {adjustment !== 0 && (
            <tr>
              <td>Ajuste por redondeo</td>
              <td className={posStyles.num}>
                {adjustment < 0 ? '−' : ''}
                {formatMoney(Math.abs(adjustment))}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className={posStyles.num}>{formatMoney(doc.imp_total)}</td>
          </tr>
          {isA ? (
            <>
              <tr>
                <th scope="row">Neto gravado</th>
                <td className={posStyles.num}>{formatMoney(doc.imp_neto)}</td>
              </tr>
              {doc.iva_breakdown.map((i) => (
                <tr key={i.id}>
                  <th scope="row">IVA {formatNumber(i.rate)} %</th>
                  <td className={posStyles.num}>{formatMoney(i.amount)}</td>
                </tr>
              ))}
            </>
          ) : (
            <>
              <tr>
                <th scope="row">IVA contenido</th>
                <td className={posStyles.num}>{formatMoney(doc.imp_iva)}</td>
              </tr>
              <tr>
                <th scope="row">Otros impuestos nacionales indirectos</th>
                <td className={posStyles.num}>{formatMoney(0)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
      <p className={styles.fiscalCae}>
        CAE n.º {doc.cae ?? '—'}
        <br />
        Vencimiento del CAE {doc.cae_expires_on ? formatDate(doc.cae_expires_on) : '—'}
      </p>
      {qrUrl && <QrCode text={qrUrl} />}
    </div>
  )
}
