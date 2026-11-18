// Pruebas del pedido de CAE (FECAESolicitar) de ARCA en HOMOLOGACIÓN. Sin red, sin certificados reales:
// todo es XML fabricado. Corren igual con Node (`node --test`) y con Deno.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArcaError, IVA_ALICUOTA_IDS, buildCaeSolicitarSoap, parseCaeSolicitarResponse, type CaeSolicitarArgs } from './arca.ts'

const base: CaeSolicitarArgs = {
  token: 'TOKEN',
  sign: 'SIGN',
  cuit: '20000000001',
  ptoVta: 11,
  cbteTipo: 6,
  cbteNro: 5,
  cbteFecha: '20261117',
  docTipo: 99,
  docNro: 0,
  receiverVatConditionId: 5,
  impTotal: 1210,
  impNeto: 1000,
  impIva: 210,
  iva: [{ id: IVA_ALICUOTA_IDS['21'], baseImp: 1000, importe: 210 }],
}

test('alícuotas: 10,5 % es el id 4 y 21 % es el id 5', () => {
  assert.equal(IVA_ALICUOTA_IDS['10.5'], 4)
  assert.equal(IVA_ALICUOTA_IDS['21'], 5)
})

test('el SOAP trae un solo comprobante con los importes con 2 decimales y la condición IVA del receptor', () => {
  const xml = buildCaeSolicitarSoap(base)
  assert.match(xml, /<ar:CantReg>1<\/ar:CantReg><ar:PtoVta>11<\/ar:PtoVta><ar:CbteTipo>6<\/ar:CbteTipo>/)
  assert.match(xml, /<ar:CbteDesde>5<\/ar:CbteDesde><ar:CbteHasta>5<\/ar:CbteHasta>/)
  assert.match(xml, /<ar:ImpTotal>1210\.00<\/ar:ImpTotal>/)
  assert.match(xml, /<ar:ImpNeto>1000\.00<\/ar:ImpNeto>/)
  assert.match(xml, /<ar:ImpIVA>210\.00<\/ar:ImpIVA>/)
  assert.match(xml, /<ar:MonId>PES<\/ar:MonId><ar:MonCotiz>1<\/ar:MonCotiz><ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/)
  assert.match(xml, /<ar:AlicIva><ar:Id>5<\/ar:Id><ar:BaseImp>1000\.00<\/ar:BaseImp><ar:Importe>210\.00<\/ar:Importe><\/ar:AlicIva>/)
})

test('varias alícuotas: una AlicIva por cada una', () => {
  const xml = buildCaeSolicitarSoap({
    ...base,
    impTotal: 2315,
    impNeto: 2000,
    impIva: 315,
    iva: [
      { id: 5, baseImp: 1000, importe: 210 },
      { id: 4, baseImp: 1000, importe: 105 },
    ],
  })
  assert.equal(xml.match(/<ar:AlicIva>/g)?.length, 2)
})

test('el token y la firma se escapan en el XML', () => {
  const xml = buildCaeSolicitarSoap({ ...base, token: 'a<b&c', sign: 'x>y' })
  assert.match(xml, /<ar:Token>a&lt;b&amp;c<\/ar:Token><ar:Sign>x&gt;y<\/ar:Sign>/)
})

for (const [name, patch, code] of [
  ['CUIT corto', { cuit: '123' }, 'INVALID_CUIT'],
  ['punto de venta 0', { ptoVta: 0 }, 'INVALID_PTO_VTA'],
  ['tipo de comprobante inválido', { cbteTipo: 0 }, 'INVALID_CBTE_TIPO'],
  ['número 0', { cbteNro: 0 }, 'INVALID_CBTE_NRO'],
  ['fecha mal formada', { cbteFecha: '2026-11-17' }, 'INVALID_DATE'],
  ['documento negativo', { docNro: -1 }, 'INVALID_DOC'],
  ['sin condición IVA del receptor', { receiverVatConditionId: 0 }, 'INVALID_VAT_CONDITION'],
  ['importe con 3 decimales', { impTotal: 1210.005 }, 'INVALID_AMOUNTS'],
  ['importe negativo', { impNeto: -1 }, 'INVALID_AMOUNTS'],
  ['neto + IVA distinto del total', { impTotal: 1000 }, 'INVALID_AMOUNTS'],
  ['alícuotas que no suman el IVA', { iva: [{ id: 5, baseImp: 1000, importe: 200 }] }, 'INVALID_AMOUNTS'],
  ['alícuotas que no suman el neto', { iva: [{ id: 5, baseImp: 900, importe: 210 }] }, 'INVALID_AMOUNTS'],
  ['sin alícuotas', { iva: [] }, 'INVALID_AMOUNTS'],
] as const) {
  test(`rechaza antes de llamar a ARCA: ${name}`, () => {
    assert.throws(
      () => buildCaeSolicitarSoap({ ...base, ...patch } as CaeSolicitarArgs),
      (error: unknown) => error instanceof ArcaError && error.code === code,
    )
  })
}

const approved =
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">' +
  '<FECAESolicitarResult><FeCabResp><Cuit>20000000001</Cuit><PtoVta>11</PtoVta><CbteTipo>6</CbteTipo><Resultado>A</Resultado></FeCabResp>' +
  '<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>5</CbteDesde><CbteHasta>5</CbteHasta>' +
  '<CbteFch>20261117</CbteFch><Resultado>A</Resultado><CAE>86461234567890</CAE><CAEFchVto>20261127</CAEFchVto></FECAEDetResponse></FeDetResp>' +
  '</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>'

test('respuesta aprobada: resultado A con CAE, vencimiento y número', () => {
  const result = parseCaeSolicitarResponse(approved)
  assert.deepEqual(result, {
    resultado: 'A',
    cae: '86461234567890',
    caeVencimiento: '20261127',
    cbteNro: 5,
    observations: [],
    errors: [],
    events: [],
  })
})

test('respuesta rechazada: resultado R, sin CAE y con la observación de ARCA', () => {
  const xml =
    '<s:Envelope xmlns:s="x"><s:Body><FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp>' +
    '<FeDetResp><FECAEDetResponse><CbteDesde>5</CbteDesde><Resultado>R</Resultado><CAE></CAE><CAEFchVto></CAEFchVto>' +
    '<Observaciones><Obs><Code>10016</Code><Msg>El n&#250;mero no es el siguiente al &#250;ltimo autorizado</Msg></Obs></Observaciones>' +
    '</FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse></s:Body></s:Envelope>'
  const result = parseCaeSolicitarResponse(xml)
  assert.equal(result.resultado, 'R')
  assert.equal(result.cae, null)
  assert.equal(result.caeVencimiento, null)
  assert.equal(result.observations.length, 1)
  assert.equal(result.observations[0].code, '10016')
})

test('errores de cabecera (por ejemplo, token vencido) se devuelven en errors', () => {
  const xml =
    '<s:Envelope xmlns:s="x"><s:Body><FECAESolicitarResponse><FECAESolicitarResult>' +
    '<Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No validaron las fechas del token</Msg></Err></Errors>' +
    '</FECAESolicitarResult></FECAESolicitarResponse></s:Body></s:Envelope>'
  const result = parseCaeSolicitarResponse(xml)
  assert.equal(result.cae, null)
  assert.equal(result.errors[0].code, '600')
})

test('un SOAP Fault se convierte en ArcaError', () => {
  const xml =
    '<soap:Envelope xmlns:soap="x"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>fallo</faultstring></soap:Fault></soap:Body></soap:Envelope>'
  assert.throws(() => parseCaeSolicitarResponse(xml), (error: unknown) => error instanceof ArcaError)
})

test('una respuesta sin FECAESolicitarResult es WSFE_BAD_RESPONSE', () => {
  assert.throws(
    () => parseCaeSolicitarResponse('<s:Envelope xmlns:s="x"><s:Body><x/></s:Body></s:Envelope>'),
    (error: unknown) => error instanceof ArcaError && error.code === 'WSFE_BAD_RESPONSE',
  )
})

test('nota de crédito: el SOAP lleva el comprobante asociado antes del IVA', () => {
  const xml = buildCaeSolicitarSoap({ ...base, cbteTipo: 8, cbtesAsoc: [{ tipo: 6, ptoVta: 11, nro: 3 }] })
  assert.match(xml, /<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>6<\/ar:Tipo><ar:PtoVta>11<\/ar:PtoVta><ar:Nro>3<\/ar:Nro><\/ar:CbteAsoc><\/ar:CbtesAsoc><ar:Iva>/)
  // Sin asociados (una factura común) no aparece el bloque.
  assert.doesNotMatch(buildCaeSolicitarSoap(base), /CbtesAsoc/)
})

for (const asoc of [{ tipo: 0, ptoVta: 11, nro: 3 }, { tipo: 6, ptoVta: 0, nro: 3 }, { tipo: 6, ptoVta: 11, nro: 0 }, { tipo: 6.5, ptoVta: 11, nro: 3 }]) {
  test(`rechaza un comprobante asociado inválido: ${JSON.stringify(asoc)}`, () => {
    assert.throws(
      () => buildCaeSolicitarSoap({ ...base, cbtesAsoc: [asoc] }),
      (error: unknown) => error instanceof ArcaError && error.code === 'INVALID_CBTE_ASOC',
    )
  })
}
