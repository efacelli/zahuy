// Pruebas de la lógica de emisión (emitir.ts) con dependencias simuladas: sin red, sin base de datos, sin
// certificados. Corren con Node (`node --test`) y con Deno.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArcaError, type CaeSolicitarResult, type CompConsultarResult } from '../arca-homologacion/arca.ts'
import { emitCreditNote, emitInvoice, resolveReceiver, SEGUNDOS_EN_VUELO, type EmitDeps, type FiscalDocument } from './emitir.ts'

const NOW = new Date('2026-11-17T15:00:00Z')
const iso = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString()

function doc(over: Partial<FiscalDocument> = {}): FiscalDocument {
  return {
    id: 'doc-1',
    sale_id: 'sale-1',
    kind: 'invoice',
    cbte_tipo: 6,
    pto_vta: 11,
    cbte_nro: 6,
    environment: 'homologacion',
    status: 'pending',
    cae: null,
    cae_expires_on: null,
    receiver_doc_type: 99,
    receiver_doc_number: '0',
    receiver_vat_condition_id: 5,
    imp_total: 1210,
    imp_neto: 1000,
    imp_iva: 210,
    iva_breakdown: [{ id: 5, rate: 21, base: 1000, amount: 210 }],
    observations: [],
    created_at: iso(1),
    sent_at: null,
    authorized_at: null,
    ...over,
  }
}

const APROBADO: CaeSolicitarResult = {
  resultado: 'A', cae: '86461234567890', caeVencimiento: '20261127', cbteNro: 6, observations: [], errors: [], events: [],
}

type Calls = { name: string; args: unknown }[]

function build(opts: {
  environment?: string
  /** Ambiente que sirve la función simulada (por defecto, homologación). */
  functionEnvironment?: 'homologacion' | 'produccion'
  begin?: FiscalDocument
  claim?: boolean
  solicitar?: () => Promise<CaeSolicitarResult>
  consultar?: () => Promise<CompConsultarResult>
  ticketStored?: boolean
  login?: () => Promise<{ token: string; sign: string; generationTime: string; expirationTime: string }>
  charged?: number
  invoice?: FiscalDocument | null
} = {}) {
  const calls: Calls = []
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const deps: EmitDeps = {
    settings: async () => ({ environment: opts.environment ?? 'homologacion', pto_vta: 11 }),
    chargedAmount: async () => opts.charged ?? 1210,
    findInvoice: async () => opts.invoice ?? null,
    rpc: (async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      if (name === 'fiscal_ticket_get') {
        return opts.ticketStored === false ? [] : [{ token: 'TOKEN-SECRETO', sign: 'SIGN-SECRETO', expiration_time: '2026-11-18T08:00:00-03:00' }]
      }
      if (name === 'fiscal_ticket_save') return null
      if (name === 'fiscal_begin') return opts.begin ?? doc()
      if (name === 'fiscal_claim') return opts.claim ?? true
      if (name === 'fiscal_finish') {
        const base = opts.begin ?? doc()
        return { ...base, status: args.p_status, cae: args.p_cae, cae_expires_on: args.p_cae_expires_on, observations: args.p_observations, authorized_at: args.p_status === 'authorized' ? NOW.toISOString() : null }
      }
      throw new Error('rpc inesperado ' + name)
    }) as EmitDeps['rpc'],
    environment: opts.functionEnvironment ?? 'homologacion',
    arca: {
      login: opts.login ?? (async () => ({ token: 'T', sign: 'S', generationTime: '2026-11-17T12:00:00-03:00', expirationTime: '2026-11-18T00:00:00-03:00' })),
      ultimo: async (_t, ptoVta, cbteTipo) => {
        calls.push({ name: 'ultimo', args: { ptoVta, cbteTipo } })
        return { ptoVta, cbteTipo, cbteNro: 5, errors: [], events: [] }
      },
      solicitar: async (_t, args) => {
        calls.push({ name: 'solicitar', args })
        return await (opts.solicitar ?? (async () => APROBADO))()
      },
      consultar: async (_t, ptoVta, cbteTipo, cbteNro) => {
        calls.push({ name: 'consultar', args: { ptoVta, cbteTipo, cbteNro } })
        return await (opts.consultar ?? (async () => { throw new Error('no se esperaba consultar') }))()
      },
    },
    now: () => NOW,
  }
  return { deps, calls, rpcCalls }
}

const INPUT = { saleId: 'sale-1', idempotencyKey: '11111111-1111-4111-8111-111111111111', createdBy: 'user-1' }
const finishOf = (rpcCalls: { name: string; args: Record<string, unknown> }[]) => rpcCalls.filter((c) => c.name === 'fiscal_finish')

// ---------------------------------------------------------------------------
test('camino feliz: pide el último a ARCA, reserva el número, reserva el envío y autoriza con CAE', async () => {
  const { deps, calls, rpcCalls } = build()
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'authorized')
  assert.equal(result.inProgress, false)
  assert.equal(result.document.cae, '86461234567890')
  assert.equal(result.document.cae_expires_on, '2026-11-27')
  assert.deepEqual(rpcCalls.map((c) => c.name), ['fiscal_ticket_get', 'fiscal_begin', 'fiscal_claim', 'fiscal_finish'])
  const begin = rpcCalls.find((c) => c.name === 'fiscal_begin')!.args
  assert.equal(begin.p_arca_last, 5)
  assert.equal(begin.p_cbte_tipo, 6)
  assert.equal(begin.p_kind, 'invoice')
  assert.equal(begin.p_created_by, 'user-1')
  const solicitar = calls.find((c) => c.name === 'solicitar')!.args as Record<string, unknown>
  assert.equal(solicitar.cbteNro, 6)
  assert.equal(solicitar.cbteFecha, '20261117')
  assert.equal(solicitar.receiverVatConditionId, 5)
  assert.deepEqual(solicitar.iva, [{ id: 5, baseImp: 1000, importe: 210 }])
})

test('nunca guarda ni devuelve el token ni la firma', async () => {
  const { deps, rpcCalls } = build()
  const result = await emitInvoice(deps, INPUT)
  const finish = finishOf(rpcCalls)[0].args
  const guardado = JSON.stringify([finish.p_request, finish.p_response, finish.p_observations])
  assert.ok(!/TOKEN-SECRETO|SIGN-SECRETO|"token"|"sign"/i.test(guardado))
  assert.ok(!/TOKEN-SECRETO|SIGN-SECRETO|"token"|"sign"/i.test(JSON.stringify(result)))
})

test('un documento ya autorizado se devuelve sin volver a pedir nada a ARCA', async () => {
  const { deps, calls, rpcCalls } = build({ begin: doc({ status: 'authorized', cae: '86461234567890', cae_expires_on: '2026-11-27', authorized_at: iso(5) }) })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'authorized')
  assert.equal(calls.some((c) => c.name === 'solicitar'), false)
  assert.equal(rpcCalls.some((c) => c.name === 'fiscal_claim' || c.name === 'fiscal_finish'), false)
})

test('si otra llamada ya reservó el envío, no se envía de nuevo (queda en curso)', async () => {
  const { deps, calls } = build({ claim: false })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.inProgress, true)
  assert.equal(result.status, 'pending')
  assert.equal(calls.some((c) => c.name === 'solicitar'), false)
})

test('ARCA rechaza: el documento queda rechazado con la observación', async () => {
  const { deps, rpcCalls } = build({
    solicitar: async () => ({ resultado: 'R', cae: null, caeVencimiento: null, cbteNro: 6, observations: [{ code: '10016', msg: 'número incorrecto' }], errors: [], events: [] }),
  })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'rejected')
  assert.equal(result.inProgress, false)
  assert.equal(finishOf(rpcCalls)[0].args.p_status, 'rejected')
  assert.deepEqual(finishOf(rpcCalls)[0].args.p_observations, [{ code: '10016', msg: 'número incorrecto' }])
})

test('ARCA responde con error de cabecera y sin resultado: rechazado (ARCA no registró nada)', async () => {
  const { deps } = build({
    solicitar: async () => ({ resultado: '', cae: null, caeVencimiento: null, cbteNro: null, observations: [], errors: [{ code: '600', msg: 'token' }], events: [] }),
  })
  assert.equal((await emitInvoice(deps, INPUT)).status, 'rejected')
})

test('si ARCA no responde: queda unknown, en curso, y NO se reintenta', async () => {
  const { deps, calls, rpcCalls } = build({ solicitar: async () => { throw new Error('tiempo agotado') } })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'unknown')
  assert.equal(result.inProgress, true)
  assert.equal(calls.filter((c) => c.name === 'solicitar').length, 1)
  assert.equal(finishOf(rpcCalls)[0].args.p_status, 'unknown')
})

test('una respuesta parcial no se decide a ciegas: queda unknown', async () => {
  const { deps } = build({ solicitar: async () => ({ ...APROBADO, resultado: 'P', cae: null, caeVencimiento: null }) })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'unknown')
})

// ---------------------------------------------------------------------------
test(`unknown reciente (menos de ${SEGUNDOS_EN_VUELO} s): no se concilia todavía`, async () => {
  const { deps, calls } = build({ begin: doc({ status: 'unknown', sent_at: iso(30) }) })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'unknown')
  assert.equal(result.inProgress, true)
  assert.equal(calls.some((c) => c.name === 'consultar' || c.name === 'solicitar'), false)
})

test('unknown viejo y ARCA lo tiene con el mismo importe: se autoriza con el CAE de ARCA', async () => {
  const { deps, calls, rpcCalls } = build({
    begin: doc({ status: 'unknown', sent_at: iso(600) }),
    consultar: async () => ({ found: true, resultado: 'A', cae: '86461234567891', caeVencimiento: '20261127', impTotal: 1210, cbteNro: 6, observations: [], errors: [] }),
  })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'authorized')
  assert.deepEqual(calls.find((c) => c.name === 'consultar')!.args, { ptoVta: 11, cbteTipo: 6, cbteNro: 6 })
  assert.equal(calls.some((c) => c.name === 'solicitar'), false)
  assert.equal(finishOf(rpcCalls)[0].args.p_cae, '86461234567891')
})

test('unknown viejo y ARCA lo tiene con OTRO importe: no se toca nada, lo resuelve una persona', async () => {
  const { deps, rpcCalls } = build({
    begin: doc({ status: 'unknown', sent_at: iso(600) }),
    consultar: async () => ({ found: true, resultado: 'A', cae: '86461234567891', caeVencimiento: '20261127', impTotal: 999, cbteNro: 6, observations: [], errors: [] }),
  })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'unknown')
  assert.equal(result.reconcile, 'MISMATCH_WITH_ARCA')
  assert.equal(finishOf(rpcCalls).length, 0)
})

test('unknown viejo y ARCA confirma que no existe (602): se da por rechazado y se puede volver a emitir', async () => {
  const { deps, rpcCalls } = build({
    begin: doc({ status: 'unknown', sent_at: iso(600) }),
    consultar: async () => ({ found: false, resultado: null, cae: null, caeVencimiento: null, impTotal: null, cbteNro: null, observations: [], errors: [{ code: '602', msg: 'no existe' }] }),
  })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'rejected')
  assert.equal(finishOf(rpcCalls)[0].args.p_status, 'rejected')
})

test('unknown viejo y la consulta falla por otro motivo: sigue unknown, sin rechazar', async () => {
  const { deps, rpcCalls } = build({
    begin: doc({ status: 'unknown', sent_at: iso(600) }),
    consultar: async () => ({ found: false, resultado: null, cae: null, caeVencimiento: null, impTotal: null, cbteNro: null, observations: [], errors: [{ code: '500', msg: 'servidor' }] }),
  })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'unknown')
  assert.equal(result.reconcile, 'CONSULT_FAILED')
  assert.equal(finishOf(rpcCalls).length, 0)
})

test('pending ya enviado hace rato (se cayó la función a mitad de camino): se concilia, no se reenvía', async () => {
  const { deps, calls } = build({
    begin: doc({ status: 'pending', sent_at: iso(900) }),
    consultar: async () => ({ found: false, resultado: null, cae: null, caeVencimiento: null, impTotal: null, cbteNro: null, observations: [], errors: [{ code: '602', msg: 'no existe' }] }),
  })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'rejected')
  assert.equal(calls.some((c) => c.name === 'solicitar'), false)
})

// ---------------------------------------------------------------------------
test('ambiente off: FISCAL_DISABLED y no se llama a nadie', async () => {
  const { deps, rpcCalls } = build({ environment: 'off' })
  await assert.rejects(() => emitInvoice(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'FISCAL_DISABLED')
  assert.equal(rpcCalls.length, 0)
})

test('ambiente producción con una función de homologación: no emite (PRODUCTION_NOT_IMPLEMENTED)', async () => {
  const { deps, rpcCalls, calls } = build({ environment: 'produccion' })
  await assert.rejects(() => emitInvoice(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'PRODUCTION_NOT_IMPLEMENTED')
  assert.equal(rpcCalls.length, 0)
  assert.equal(calls.length, 0)
})

test('función de producción con la configuración en producción: emite y usa el ticket de producción', async () => {
  const { deps, calls, rpcCalls } = build({ environment: 'produccion', functionEnvironment: 'produccion' })
  const result = await emitInvoice(deps, INPUT)
  assert.equal(result.status, 'authorized')
  assert.ok(calls.some((c) => c.name === 'solicitar'))
  const ticket = rpcCalls.find((c) => c.name === 'fiscal_ticket_get')!.args
  assert.equal(ticket.p_environment, 'produccion')
})

test('función de producción con la configuración en homologación: ENVIRONMENT_MISMATCH y no llama a nadie', async () => {
  const { deps, rpcCalls, calls } = build({ environment: 'homologacion', functionEnvironment: 'produccion' })
  await assert.rejects(() => emitInvoice(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'ENVIRONMENT_MISMATCH')
  assert.equal(rpcCalls.length, 0)
  assert.equal(calls.length, 0)
})

test('la función de producción también apaga con off y exige punto de venta', async () => {
  const off = build({ environment: 'off', functionEnvironment: 'produccion' })
  await assert.rejects(() => emitInvoice(off.deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'FISCAL_DISABLED')
  const sinPunto = build({ environment: 'produccion', functionEnvironment: 'produccion' })
  sinPunto.deps.settings = async () => ({ environment: 'produccion', pto_vta: null })
  await assert.rejects(() => emitInvoice(sinPunto.deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'NOT_CONFIGURED')
})

test('un ambiente fiscal desconocido no emite', async () => {
  const { deps, rpcCalls } = build({ environment: 'pruebas' })
  await assert.rejects(() => emitInvoice(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'NOT_CONFIGURED')
  assert.equal(rpcCalls.length, 0)
})

test('desde $10.000.000 hay que identificar al comprador', async () => {
  const { deps } = build({ charged: 10_000_000 })
  await assert.rejects(() => emitInvoice(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'IDENTIFICATION_REQUIRED')
  const ok = build({ charged: 10_000_000 })
  const result = await emitInvoice(ok.deps, { ...INPUT, receiver: { docType: 96, docNumber: '12345678', vatConditionId: 5 } })
  assert.equal(result.status, 'authorized')
})

test('sin ticket guardado: se pide uno a ARCA y se guarda', async () => {
  const { deps, rpcCalls } = build({ ticketStored: false })
  await emitInvoice(deps, INPUT)
  assert.deepEqual(rpcCalls.slice(0, 2).map((c) => c.name), ['fiscal_ticket_get', 'fiscal_ticket_save'])
})

test('ARCA ya entregó un ticket que no tenemos guardado: TICKET_UNAVAILABLE', async () => {
  const { deps } = build({ ticketStored: false, login: async () => { throw new ArcaError('coe.alreadyAuthenticated', 'ya posee un TA valido') } })
  await assert.rejects(() => emitInvoice(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'TICKET_UNAVAILABLE')
})

// ---------------------------------------------------------------------------
test('Factura A: responsable inscripto con CUIT; monotributo también', () => {
  assert.equal(resolveReceiver({ vatConditionId: 1, docType: 80, docNumber: '20000000001' }).cbteTipo, 1)
  assert.equal(resolveReceiver({ vatConditionId: 6, docType: 80, docNumber: '20000000001' }).cbteTipo, 1)
})
test('Factura B: consumidor final, exento y no categorizado', () => {
  assert.equal(resolveReceiver(undefined).cbteTipo, 6)
  assert.equal(resolveReceiver({ vatConditionId: 4 }).cbteTipo, 6)
  assert.equal(resolveReceiver({ vatConditionId: 7 }).cbteTipo, 6)
})
for (const [name, input] of [
  ['A sin CUIT', { vatConditionId: 1 }],
  ['A con DNI', { vatConditionId: 1, docType: 96, docNumber: '12345678' }],
  ['CUIT corto', { vatConditionId: 1, docType: 80, docNumber: '123' }],
  ['DNI corto', { docType: 96, docNumber: '123' }],
  ['sin identificar con documento', { docType: 99, docNumber: '12345678' }],
  ['tipo de documento desconocido', { docType: 55, docNumber: '1' }],
  ['condición inválida', { vatConditionId: 0 }],
] as const) {
  test(`receptor inválido: ${name}`, () => {
    assert.throws(() => resolveReceiver(input), (e: unknown) => e instanceof ArcaError && e.code === 'INVALID_RECEIVER')
  })
}

test('emite Factura A cuando el receptor es responsable inscripto con CUIT', async () => {
  const { deps, rpcCalls, calls } = build({ begin: doc({ cbte_tipo: 1, receiver_doc_type: 80, receiver_doc_number: '20000000001', receiver_vat_condition_id: 1 }) })
  await emitInvoice(deps, { ...INPUT, receiver: { vatConditionId: 1, docType: 80, docNumber: '20000000001' } })
  assert.equal(rpcCalls.find((c) => c.name === 'fiscal_begin')!.args.p_cbte_tipo, 1)
  assert.deepEqual(calls.find((c) => c.name === 'ultimo')!.args, { ptoVta: 11, cbteTipo: 1 })
})

// ---------------------------------------------------------------------------
// Notas de crédito (contrato §22.5)
// ---------------------------------------------------------------------------
const FACTURA_B = doc({ id: 'inv-1', status: 'authorized', cbte_nro: 3, cae: '86461234567890', cae_expires_on: '2026-11-27', authorized_at: iso(60) })

test('nota de crédito: tipo de la factura + 2, asociada a la factura, mismos importes y receptor', async () => {
  const nota = doc({ id: 'nc-1', kind: 'credit_note', cbte_tipo: 8, cbte_nro: 1 })
  const { deps, calls, rpcCalls } = build({ invoice: FACTURA_B, begin: nota })
  const result = await emitCreditNote(deps, INPUT)
  assert.equal(result.status, 'authorized')
  const begin = rpcCalls.find((c) => c.name === 'fiscal_begin')!.args
  assert.equal(begin.p_kind, 'credit_note')
  assert.equal(begin.p_cbte_tipo, 8)
  assert.equal(begin.p_original_document_id, 'inv-1')
  assert.equal(begin.p_receiver_vat_condition_id, 5)
  assert.deepEqual(calls.find((c) => c.name === 'ultimo')!.args, { ptoVta: 11, cbteTipo: 8 })
  const solicitar = calls.find((c) => c.name === 'solicitar')!.args as Record<string, unknown>
  assert.deepEqual(solicitar.cbtesAsoc, [{ tipo: 6, ptoVta: 11, nro: 3 }])
  assert.equal(solicitar.impTotal, 1210)
})

test('nota de crédito de una Factura A lleva el tipo 3', async () => {
  const facturaA = doc({ id: 'inv-2', status: 'authorized', cbte_tipo: 1, cbte_nro: 9, receiver_doc_type: 80, receiver_doc_number: '20000000001', receiver_vat_condition_id: 1, cae: '86461234567890', cae_expires_on: '2026-11-27', authorized_at: iso(60) })
  const { deps, rpcCalls } = build({ invoice: facturaA, begin: doc({ kind: 'credit_note', cbte_tipo: 3, cbte_nro: 1 }) })
  await emitCreditNote(deps, INPUT)
  assert.equal(rpcCalls.find((c) => c.name === 'fiscal_begin')!.args.p_cbte_tipo, 3)
})

test('sin factura autorizada no hay nota de crédito (NO_INVOICE) y no se llama a ARCA', async () => {
  const sin = build({ invoice: null })
  await assert.rejects(() => emitCreditNote(sin.deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'NO_INVOICE')
  assert.equal(sin.calls.length, 0)
  const pendiente = build({ invoice: doc({ status: 'pending' }) })
  await assert.rejects(() => emitCreditNote(pendiente.deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === 'NO_INVOICE')
})

test('la nota de crédito también respeta los ambientes (off y producción)', async () => {
  for (const [environment, code] of [['off', 'FISCAL_DISABLED'], ['produccion', 'PRODUCTION_NOT_IMPLEMENTED']] as const) {
    const { deps } = build({ environment, invoice: FACTURA_B })
    await assert.rejects(() => emitCreditNote(deps, INPUT), (e: unknown) => e instanceof ArcaError && e.code === code)
  }
})
