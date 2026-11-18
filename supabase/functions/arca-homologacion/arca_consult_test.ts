// Pruebas de la consulta de comprobantes (FECompConsultar) de ARCA en HOMOLOGACIÓN. Sin red: XML fabricado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARCA_COMPROBANTE_NO_EXISTE, ArcaError, buildCompConsultarSoap, parseCompConsultarResponse } from './arca.ts'

const base = { token: 'TOKEN', sign: 'SIGN', cuit: '20000000001', ptoVta: 11, cbteTipo: 6, cbteNro: 7 }

test('el SOAP pide el comprobante por tipo, número y punto de venta, y escapa el token', () => {
  const xml = buildCompConsultarSoap({ ...base, token: 'a<b&c' })
  assert.match(xml, /<ar:FeCompConsReq><ar:CbteTipo>6<\/ar:CbteTipo><ar:CbteNro>7<\/ar:CbteNro><ar:PtoVta>11<\/ar:PtoVta><\/ar:FeCompConsReq>/)
  assert.match(xml, /<ar:Token>a&lt;b&amp;c<\/ar:Token>/)
})

for (const [name, patch, code] of [
  ['CUIT corto', { cuit: '1' }, 'INVALID_CUIT'],
  ['punto de venta 0', { ptoVta: 0 }, 'INVALID_PTO_VTA'],
  ['tipo inválido', { cbteTipo: 0 }, 'INVALID_CBTE_TIPO'],
  ['número 0', { cbteNro: 0 }, 'INVALID_CBTE_NRO'],
] as const) {
  test(`rechaza antes de llamar a ARCA: ${name}`, () => {
    assert.throws(() => buildCompConsultarSoap({ ...base, ...patch }), (e: unknown) => e instanceof ArcaError && e.code === code)
  })
}

test('comprobante encontrado: resultado, CAE, vencimiento, importe y número', () => {
  const xml =
    '<s:Envelope xmlns:s="x"><s:Body><FECompConsultarResponse><FECompConsultarResult><ResultGet>' +
    '<Concepto>1</Concepto><CbteDesde>7</CbteDesde><CbteHasta>7</CbteHasta><ImpTotal>1210.00</ImpTotal><Resultado>A</Resultado>' +
    '<CodAutorizacion>86461234567890</CodAutorizacion><FchVto>20261127</FchVto></ResultGet></FECompConsultarResult></FECompConsultarResponse></s:Body></s:Envelope>'
  const result = parseCompConsultarResponse(xml)
  assert.deepEqual(result, {
    found: true, resultado: 'A', cae: '86461234567890', caeVencimiento: '20261127', impTotal: 1210, cbteNro: 7, observations: [], errors: [],
  })
})

test('comprobante inexistente (602): found = false y el error de ARCA', () => {
  const xml =
    '<s:Envelope xmlns:s="x"><s:Body><FECompConsultarResponse><FECompConsultarResult>' +
    `<Errors><Err><Code>${ARCA_COMPROBANTE_NO_EXISTE}</Code><Msg>No existen datos en nuestros registros</Msg></Err></Errors>` +
    '</FECompConsultarResult></FECompConsultarResponse></s:Body></s:Envelope>'
  const result = parseCompConsultarResponse(xml)
  assert.equal(result.found, false)
  assert.equal(result.errors[0].code, '602')
  assert.equal(result.cae, null)
})

test('un SOAP Fault se convierte en ArcaError y una respuesta sin resultado es WSFE_BAD_RESPONSE', () => {
  assert.throws(
    () => parseCompConsultarResponse('<soap:Envelope xmlns:soap="x"><soap:Body><soap:Fault><faultcode>x</faultcode><faultstring>fallo</faultstring></soap:Fault></soap:Body></soap:Envelope>'),
    (e: unknown) => e instanceof ArcaError,
  )
  assert.throws(
    () => parseCompConsultarResponse('<s:Envelope xmlns:s="x"><s:Body><x/></s:Body></s:Envelope>'),
    (e: unknown) => e instanceof ArcaError && e.code === 'WSFE_BAD_RESPONSE',
  )
})
