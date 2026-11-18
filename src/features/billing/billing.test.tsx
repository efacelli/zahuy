import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { emitFiscalDocument, fiscalMessage, formatCbteNumber, receiverError } from './billing-api'

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
