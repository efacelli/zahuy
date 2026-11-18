import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { arcaQrUrl, emitFiscalDocument, fiscalMessage, formatCbteNumber, receiverError, validateFiscalSettings, type FiscalDocumentRow } from './billing-api'

const SALE: Record<string, unknown> = {
  id: 'sale-14',
  sale_number: 14,
  created_at: '2026-11-15T22:17:00Z',
  status: 'completed',
  total_amount: 1210,
  rounding_amount: 0,
  notes: null,
  voided_at: null,
  void_reason: null,
  cash_session: { status: 'open', cash_register: { name: 'Caja 1' } },
  seller: { full_name: 'Ana Cajera' },
  voider: null,
  sale_items: [
    { product_name: 'Leche entera', product_sku: '000002', quantity: 1, unit_price_with_vat: 1210, line_total: 1210, discount_percent: 0, discount_amount: 0, vat_rate: 21, price_source: 'list', catalog_line_total: null },
  ],
  sale_payments: [{ amount: 1210, tendered_amount: null, reference: null, payment_method: { name: 'Débito', is_cash: false, sort_order: 2 } }],
}

const DOC = {
  id: 'doc-1',
  sale_id: 'sale-14',
  kind: 'invoice',
  cbte_tipo: 6,
  pto_vta: 11,
  cbte_nro: 12,
  environment: 'homologacion',
  status: 'authorized',
  cae: '86461234567890',
  cae_expires_on: '2026-11-27',
  imp_total: 1210,
  imp_neto: 1000,
  imp_iva: 210,
  iva_breakdown: [{ id: 5, rate: 21, base: 1000, amount: 210 }],
  receiver_doc_type: 99,
  receiver_doc_number: '0',
  receiver_vat_condition_id: 5,
  authorized_at: '2026-11-17T22:00:00Z',
  created_at: '2026-11-17T22:00:00Z',
}

function setup({ environment = 'homologacion', documents = [] as Record<string, unknown>[], sale = SALE } = {}) {
  const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
  fake.setTable('sales', [sale])
  if (environment !== null) fake.setTable('fiscal_settings', [{ environment, pto_vta: 11 }])
  fake.setTable('fiscal_documents', documents)
  renderApp('/ventas', fake.client)
  return { fake, user: userEvent.setup() }
}

async function openSale(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Ver venta n.º 14' }))
  return await screen.findByRole('dialog', { name: 'Venta n.º 14' })
}

describe('facturación: reglas puras', () => {
  it('formatea el número del comprobante', () => {
    expect(formatCbteNumber(11, 12)).toBe('00011-00000012')
  })

  it('valida al cliente igual que la función', () => {
    const base = { identify: true, docType: 80, docNumber: '20000000001', vatConditionId: 1 }
    expect(receiverError({ ...base, identify: false })).toBeNull()
    expect(receiverError(base)).toBeNull()
    expect(receiverError({ ...base, docNumber: '123' })).toMatch(/CUIT/)
    expect(receiverError({ ...base, docType: 96, docNumber: '12345678' })).toMatch(/Factura A necesita el CUIT/)
    expect(receiverError({ ...base, docType: 96, docNumber: '12345678', vatConditionId: 5 })).toBeNull()
    expect(receiverError({ ...base, docType: 96, docNumber: '123', vatConditionId: 5 })).toMatch(/DNI/)
  })

  it('todo código de la función tiene su mensaje en español y los desconocidos uno genérico', () => {
    expect(fiscalMessage('NO_INVOICE')).toMatch(/no tiene una factura autorizada/)
    expect(fiscalMessage('IDENTIFICATION_REQUIRED')).toMatch(/10\.000\.000/)
    expect(fiscalMessage('XYZ')).toMatch(/No se pudo emitir/)
    expect(fiscalMessage(null)).toMatch(/No se pudo emitir/)
  })

  it('un 202 llega como respuesta y un 4xx/5xx como error con cuerpo: los dos se leen como resultado', async () => {
    const fake = createFakeSupabase(fakeSession())
    fake.setFunctionResult('arca-emitir', 202, { ok: false, status: 'unknown', inProgress: true })
    const outcome = await emitFiscalDocument(fake.client, { action: 'invoice', sale_id: 's', idempotency_key: 'k' })
    // En supabase-js un 202 llega como respuesta correcta (2xx); un 4xx/5xx llega como error con la respuesta en context.
    expect(outcome).toMatchObject({ ok: false, status: 'unknown', inProgress: true })
    fake.setFunctionResult('arca-emitir', 409, { ok: false, code: 'NO_INVOICE' })
    expect((await emitFiscalDocument(fake.client, { action: 'credit_note', sale_id: 's', idempotency_key: 'k' })).code).toBe('NO_INVOICE')
  })
})

describe('facturación en el detalle de la venta', () => {
  it('con la facturación apagada no aparece nada', async () => {
    const { user } = setup({ environment: 'off' })
    const dialog = await openSale(user)
    expect(within(dialog).queryByRole('region', { name: 'Facturación electrónica' })).not.toBeInTheDocument()
  })

  it('si la base todavía no tiene la facturación, no aparece nada', async () => {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    fake.setTable('sales', [SALE])
    fake.setTable('fiscal_settings', null, { code: '42P01', message: 'relation does not exist' })
    renderApp('/ventas', fake.client)
    const user = userEvent.setup()
    const dialog = await openSale(user)
    expect(within(dialog).queryByRole('region', { name: 'Facturación electrónica' })).not.toBeInTheDocument()
  })

  it('en homologación avisa que no tiene validez fiscal y ofrece facturar', async () => {
    const { user } = setup()
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    expect(section).toHaveTextContent('Ambiente de prueba: sin validez fiscal')
    expect(within(section).getByRole('button', { name: 'Facturar…' })).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /Nota de crédito/ })).not.toBeInTheDocument()
  })

  it('factura a consumidor final: llama a la función sin datos del cliente y muestra el resultado', async () => {
    const { fake, user } = setup()
    fake.setFunctionResult('arca-emitir', 200, { ok: true, status: 'authorized', inProgress: false, document: { ...DOC } })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    await user.click(within(section).getByRole('button', { name: 'Facturar…' }))
    await user.click(within(section).getByRole('button', { name: 'Emitir factura' }))

    await waitFor(() => expect(fake.functions.invoke).toHaveBeenCalledOnce())
    const [name, options] = fake.functions.invoke.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(name).toBe('arca-emitir')
    expect(options.body).toMatchObject({ action: 'invoice', sale_id: 'sale-14' })
    expect(options.body.idempotency_key).toEqual(expect.any(String))
    expect(options.body.receiver).toBeUndefined()
  })

  it('identificar al cliente con Factura A exige el CUIT antes de llamar a la función', async () => {
    const { fake, user } = setup()
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    await user.click(within(section).getByRole('button', { name: 'Facturar…' }))
    await user.click(within(section).getByLabelText(/Identificar al cliente/))
    await user.selectOptions(within(section).getByLabelText(/Condición frente al IVA/), 'Responsable inscripto (Factura A)')
    await user.selectOptions(within(section).getByLabelText(/Tipo de documento/), 'DNI')
    await user.type(within(section).getByLabelText(/^Número/), '12345678')
    await user.click(within(section).getByRole('button', { name: 'Emitir factura' }))
    expect(await within(section).findByText('La Factura A necesita el CUIT del cliente.')).toBeInTheDocument()
    expect(fake.functions.invoke).not.toHaveBeenCalled()

    await user.selectOptions(within(section).getByLabelText(/Tipo de documento/), 'CUIT')
    await user.clear(within(section).getByLabelText(/^Número/))
    await user.type(within(section).getByLabelText(/^Número/), '20000000001')
    fake.setFunctionResult('arca-emitir', 200, { ok: true, status: 'authorized', inProgress: false, document: { ...DOC, cbte_tipo: 1 } })
    await user.click(within(section).getByRole('button', { name: 'Emitir factura' }))
    await waitFor(() => expect(fake.functions.invoke).toHaveBeenCalledOnce())
    const options = fake.functions.invoke.mock.calls[0]![1] as { body: Record<string, unknown> }
    expect(options.body.receiver).toEqual({ docType: 80, docNumber: '20000000001', vatConditionId: 1 })
  })

  it('con ARCA sin responder (202) explica que falta confirmar y ofrece consultar', async () => {
    const { fake, user } = setup()
    fake.setFunctionResult('arca-emitir', 202, { ok: false, status: 'unknown', inProgress: true })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    await user.click(within(section).getByRole('button', { name: 'Facturar…' }))
    await user.click(within(section).getByRole('button', { name: 'Emitir factura' }))
    expect(await within(section).findByText(/todavía no está confirmada por ARCA/)).toBeInTheDocument()
  })

  it('una factura autorizada se muestra con su número y CAE, y ofrece la nota de crédito', async () => {
    const { fake, user } = setup({ documents: [DOC] })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    const list = within(section).getByRole('list', { name: 'Comprobantes de la venta' })
    expect(list).toHaveTextContent('Factura B 00011-00000012')
    expect(list).toHaveTextContent('Autorizado')
    expect(list).toHaveTextContent('CAE 86461234567890')
    expect(within(section).queryByRole('button', { name: 'Facturar…' })).not.toBeInTheDocument()

    fake.setFunctionResult('arca-emitir', 200, { ok: true, status: 'authorized', inProgress: false, document: { ...DOC, kind: 'credit_note', cbte_tipo: 8, cbte_nro: 1 } })
    await user.click(within(section).getByRole('button', { name: 'Nota de crédito…' }))
    await user.click(within(section).getByRole('button', { name: 'Emitir nota de crédito' }))
    await waitFor(() => expect(fake.functions.invoke).toHaveBeenCalledOnce())
    const options = fake.functions.invoke.mock.calls[0]![1] as { body: Record<string, unknown> }
    expect(options.body).toMatchObject({ action: 'credit_note', sale_id: 'sale-14' })
  })

  it('con la nota de crédito autorizada ya no se ofrece otra', async () => {
    const credit = { ...DOC, id: 'doc-2', kind: 'credit_note', cbte_tipo: 8, cbte_nro: 1, created_at: '2026-11-17T23:00:00Z' }
    const { user } = setup({ documents: [DOC, credit] })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    expect(within(section).getByRole('list', { name: 'Comprobantes de la venta' })).toHaveTextContent('Nota de crédito B 00011-00000001')
    expect(within(section).queryByRole('button', { name: /Nota de crédito…/ })).not.toBeInTheDocument()
  })

  it('un comprobante sin confirmar ofrece consultar el estado', async () => {
    const { fake, user } = setup({ documents: [{ ...DOC, status: 'unknown', cae: null, cae_expires_on: null }] })
    fake.setFunctionResult('arca-emitir', 200, { ok: true, status: 'authorized', inProgress: false, document: { ...DOC } })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    expect(section).toHaveTextContent('Sin confirmar')
    await user.click(within(section).getByRole('button', { name: 'Consultar estado' }))
    await waitFor(() => expect(fake.functions.invoke).toHaveBeenCalledOnce())
  })

  it('una venta anulada no se factura', async () => {
    const { user } = setup({ sale: { ...SALE, status: 'voided', voided_at: '2026-11-15T23:00:00Z', void_reason: 'Prueba' } })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    expect(within(section).queryByRole('button', { name: 'Facturar…' })).not.toBeInTheDocument()
  })

  it('un error de la función se muestra en español', async () => {
    const { fake, user } = setup()
    fake.setFunctionResult('arca-emitir', 501, { ok: false, code: 'PRODUCTION_NOT_IMPLEMENTED' })
    const dialog = await openSale(user)
    const section = await within(dialog).findByRole('region', { name: 'Facturación electrónica' })
    await user.click(within(section).getByRole('button', { name: 'Facturar…' }))
    await user.click(within(section).getByRole('button', { name: 'Emitir factura' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent('solo se puede facturar en el ambiente de prueba')
  })
})

// ---------------------------------------------------------------------------
// Comprobante fiscal imprimible, QR de ARCA y configuración fiscal
// ---------------------------------------------------------------------------
const ISSUER = {
  issuer_name: 'Razón social de prueba',
  issuer_tax_id: '20000000001',
  issuer_address: 'Calle Falsa 123',
  gross_income_number: '20000000001',
  activity_start_date: '2000-03-01',
}

function setupFiscal({ documents = [DOC] as Record<string, unknown>[], settings = { environment: 'homologacion', pto_vta: 11, caea_pto_vta: null, id: 'fs-1', ...ISSUER } } = {}) {
  const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
  fake.setTable('sales', [SALE])
  fake.setTable('fiscal_settings', [settings])
  fake.setTable('fiscal_documents', documents)
  renderApp('/ventas', fake.client)
  return { fake, user: userEvent.setup() }
}

describe('comprobante fiscal impreso', () => {
  it('con una factura autorizada se imprime el comprobante fiscal (no el ticket interno) con emisor, CAE y QR', async () => {
    const { user } = setupFiscal()
    const dialog = await openSale(user)
    const ticket = await within(dialog).findByLabelText('Comprobante fiscal')
    expect(ticket).toHaveAttribute('data-print', 'ticket')
    expect(ticket).toHaveTextContent('PRUEBA · SIN VALIDEZ FISCAL')
    expect(ticket).toHaveTextContent('Razón social de prueba')
    expect(ticket).toHaveTextContent('Calle Falsa 123')
    expect(ticket).toHaveTextContent('CUIT 20-00000000-1 · IVA Responsable Inscripto')
    expect(ticket).toHaveTextContent('Ing. Brutos 20000000001')
    expect(ticket).toHaveTextContent('Inicio de actividades 01/03/2000')
    expect(ticket).toHaveTextContent('FACTURA B · Cód. 006')
    expect(ticket).toHaveTextContent('N.º 00011-00000012')
    expect(ticket).toHaveTextContent('Cliente: Consumidor final')
    expect(ticket).toHaveTextContent('1 × Leche entera')
    expect(ticket).toHaveTextContent('IVA contenido')
    expect(ticket).toHaveTextContent('CAE n.º 86461234567890')
    expect(ticket).toHaveTextContent('Vencimiento del CAE 27/11/2026')
    expect(within(ticket).getByRole('img', { name: 'Código QR de ARCA' })).toBeInTheDocument()
    expect(within(ticket).queryByRole('alert')).not.toBeInTheDocument()
    // El ticket interno no se imprime junto con la factura.
    expect(within(dialog).queryByText('NO VÁLIDO COMO FACTURA')).not.toBeInTheDocument()
  })

  it('una venta sin comprobante sigue mostrando el ticket interno', async () => {
    const { user } = setupFiscal({ documents: [] })
    const dialog = await openSale(user)
    expect(within(dialog).queryByLabelText('Comprobante fiscal')).not.toBeInTheDocument()
    expect(await within(dialog).findByText('NO VÁLIDO COMO FACTURA')).toBeInTheDocument()
  })

  it('si faltan datos del emisor lo avisa en el comprobante', async () => {
    const { user } = setupFiscal({ settings: { environment: 'homologacion', pto_vta: 11, caea_pto_vta: null, id: 'fs-1', ...ISSUER, issuer_tax_id: null as unknown as string, gross_income_number: null as unknown as string } })
    const dialog = await openSale(user)
    const ticket = await within(dialog).findByLabelText('Comprobante fiscal')
    expect(within(ticket).getByRole('alert')).toHaveTextContent('Faltan datos del emisor en Configuración: CUIT, Ingresos Brutos.')
    // Sin CUIT no hay QR (la URL de ARCA lo necesita).
    expect(within(ticket).queryByRole('img', { name: 'Código QR de ARCA' })).not.toBeInTheDocument()
  })

  it('con factura y nota de crédito se elige cuál ver; la nota dice qué factura anula', async () => {
    const credit = { ...DOC, id: 'doc-2', kind: 'credit_note', cbte_tipo: 8, cbte_nro: 1, created_at: '2026-11-17T23:00:00Z', authorized_at: '2026-11-17T23:00:00Z' }
    const { user } = setupFiscal({ documents: [DOC, credit] })
    const dialog = await openSale(user)
    const ticket = await within(dialog).findByLabelText('Comprobante fiscal')
    // Por defecto, el último: la nota de crédito.
    expect(ticket).toHaveTextContent('NOTA DE CRÉDITO B · Cód. 008')
    expect(ticket).toHaveTextContent('Anula Factura B 00011-00000012')
    await user.selectOptions(within(dialog).getByLabelText('Comprobante para ver e imprimir'), 'Factura B 00011-00000012')
    expect(within(dialog).getByLabelText('Comprobante fiscal')).toHaveTextContent('FACTURA B · Cód. 006')
  })

  it('la venta con redondeo muestra el ajuste para que el comprobante cierre', async () => {
    const { user } = setupFiscal({ documents: [{ ...DOC, imp_total: 1200, imp_neto: 991.74, imp_iva: 208.26 }] })
    const dialog = await openSale(user)
    const ticket = await within(dialog).findByLabelText('Comprobante fiscal')
    expect(ticket).toHaveTextContent(/Ajuste por redondeo\s*−\$\s10,00/)
  })

  it('una Factura A discrimina el neto gravado y el IVA por alícuota', async () => {
    const facturaA = { ...DOC, cbte_tipo: 1, receiver_doc_type: 80, receiver_doc_number: '20000000001', receiver_vat_condition_id: 1 }
    const { user } = setupFiscal({ documents: [facturaA] })
    const dialog = await openSale(user)
    const ticket = await within(dialog).findByLabelText('Comprobante fiscal')
    expect(ticket).toHaveTextContent('FACTURA A · Cód. 001')
    expect(ticket).toHaveTextContent('Cliente: CUIT 20000000001 · Responsable inscripto')
    expect(ticket).toHaveTextContent('Neto gravado')
    expect(ticket).toHaveTextContent(/IVA 21 %/)
    expect(ticket).not.toHaveTextContent('IVA contenido')
  })
})

describe('código QR de ARCA', () => {
  const doc = (over: Partial<FiscalDocumentRow> = {}) => ({ ...(DOC as unknown as FiscalDocumentRow), ...over })

  it('arma la URL con el JSON en base64 de la RG 4892', () => {
    const url = arcaQrUrl(doc(), '20000000001')!
    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true)
    const json = JSON.parse(atob(decodeURIComponent(url.split('?p=')[1]!)))
    expect(json).toEqual({
      ver: 1, fecha: '2026-11-17', cuit: 20000000001, ptoVta: 11, tipoCmp: 6, nroCmp: 12, importe: 1210,
      moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: 86461234567890,
    })
  })

  it('usa la fecha de Argentina (a las 23:30 locales ya es el día siguiente en UTC)', () => {
    const url = arcaQrUrl(doc({ authorized_at: '2026-11-18T02:30:00Z' }), '20000000001')!
    expect(JSON.parse(atob(decodeURIComponent(url.split('?p=')[1]!))).fecha).toBe('2026-11-17')
  })

  it('no hay QR sin CAE, sin autorización o sin CUIT del emisor', () => {
    expect(arcaQrUrl(doc({ status: 'unknown' }), '20000000001')).toBeNull()
    expect(arcaQrUrl(doc({ cae: null }), '20000000001')).toBeNull()
    expect(arcaQrUrl(doc(), null)).toBeNull()
    expect(arcaQrUrl(doc(), '123')).toBeNull()
  })
})

describe('configuración fiscal', () => {
  const form = { environment: 'homologacion', pto_vta: '11', caea_pto_vta: '', ...{ issuer_name: 'Razón social de prueba', issuer_tax_id: '20000000001', issuer_address: 'Calle Falsa 123', gross_income_number: '20000000001', activity_start_date: '2000-03-01' } } as const

  it('valida igual que la base', () => {
    expect(validateFiscalSettings(form, true).errors).toEqual({})
    expect(validateFiscalSettings({ ...form, pto_vta: '' }, true).errors.pto_vta).toMatch(/Falta el punto de venta/)
    expect(validateFiscalSettings({ ...form, environment: 'off', pto_vta: '' }, true).errors).toEqual({})
    expect(validateFiscalSettings({ ...form, pto_vta: '0' }, true).errors.pto_vta).toMatch(/entre 1 y 99998/)
    expect(validateFiscalSettings({ ...form, caea_pto_vta: '11' }, true).errors.caea_pto_vta).toMatch(/distinto/)
    expect(validateFiscalSettings({ ...form, issuer_tax_id: '123' }, true).errors.issuer_tax_id).toMatch(/11 dígitos/)
    expect(validateFiscalSettings({ ...form, issuer_name: 'a'.repeat(81) }, true).errors.issuer_name).toMatch(/80/)
    expect(validateFiscalSettings({ ...form, gross_income_number: 'abc' }, true).errors.gross_income_number).toMatch(/números y guiones/)
    expect(validateFiscalSettings({ ...form, activity_start_date: '2999-01-01' }, true).errors.activity_start_date).toMatch(/futura/)
    expect(validateFiscalSettings({ ...form, activity_start_date: 'ayer' }, true).errors.activity_start_date).toMatch(/inválida/)
  })

  it('arma la actualización: vacíos como null y sin tocar producción', () => {
    const vacio = validateFiscalSettings({ ...form, caea_pto_vta: '', issuer_name: '  ' }, true).update!
    expect(vacio).toMatchObject({ environment: 'homologacion', pto_vta: 11, caea_pto_vta: null, issuer_name: null, issuer_tax_id: '20000000001' })
    const prod = validateFiscalSettings({ ...form, environment: 'produccion' }, true).update!
    expect('environment' in prod).toBe(false)
    // Base sin las columnas del emisor: solo ambiente y puntos de venta.
    expect(Object.keys(validateFiscalSettings(form, false).update!).sort()).toEqual(['caea_pto_vta', 'environment', 'pto_vta'])
  })

  function setupSettings(role: 'admin' | 'manager') {
    const fake = createFakeSupabase(fakeSession(), { role })
    fake.setTable('fiscal_settings', [{ id: 'fs-1', environment: 'off', pto_vta: null, caea_pto_vta: null, issuer_name: null, issuer_tax_id: null, issuer_address: null, gross_income_number: null, activity_start_date: null }])
    renderApp('/configuracion', fake.client)
    return { fake, user: userEvent.setup() }
  }

  it('el dueño activa la facturación de prueba y carga los datos del emisor', async () => {
    const { fake, user } = setupSettings('admin')
    const panel = await screen.findByRole('region', { name: 'Facturación electrónica' })
    expect(panel).toHaveTextContent('sin validez fiscal')
    await user.selectOptions(await within(panel).findByLabelText(/^Facturación/), 'homologacion')
    await user.type(within(panel).getByLabelText(/^Punto de venta(?! de CAEA)/), '11')
    await user.type(within(panel).getByLabelText(/Razón social/), 'Razón social de prueba')
    await user.type(within(panel).getByLabelText(/^CUIT/), '20000000001')
    await user.click(within(panel).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fake.writes.some((w) => w.table === 'fiscal_settings' && w.op === 'update')).toBe(true))
    const write = fake.writes.find((w) => w.table === 'fiscal_settings')!
    expect(write.filters).toMatchObject({ id: 'fs-1' })
    expect(write.payload).toMatchObject({ environment: 'homologacion', pto_vta: 11, issuer_name: 'Razón social de prueba', issuer_tax_id: '20000000001' })
  })

  it('con la facturación activada avisa qué datos del emisor faltan', async () => {
    const { user } = setupSettings('admin')
    const panel = await screen.findByRole('region', { name: 'Facturación electrónica' })
    await user.selectOptions(await within(panel).findByLabelText(/^Facturación/), 'homologacion')
    expect(await within(panel).findByRole('status')).toHaveTextContent('falta: razón social, CUIT, domicilio comercial, Ingresos Brutos, inicio de actividades')
  })

  it('el encargado no ve el panel (la configuración fiscal es del dueño)', async () => {
    setupSettings('manager')
    await screen.findByRole('heading', { name: 'Configuración' })
    expect(screen.queryByRole('region', { name: 'Facturación electrónica' })).not.toBeInTheDocument()
  })
})
