// Pruebas de la lógica de ARCA (se llama arca_test.ts y no .test.ts para que el Vitest del frontend no la tome). Usan `node:test`, que corre igual con Node y con Deno.
// No hacen llamadas de red ni usan certificados reales: el certificado y la clave
// se generan en memoria en cada ejecución y no se guardan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import forge from 'node-forge'
import {
  ArcaError,
  WSAA_HOMO_URL,
  WSAA_PROD_URL,
  WSFE_HOMO_URL,
  WSFE_PROD_URL,
  arcaUrls,
  buildLoginSoap,
  buildTra,
  buildUltimoAutorizadoSoap,
  callDummy,
  formatArDateTime,
  parseDummyResponse,
  parseLoginResponse,
  parseUltimoAutorizadoResponse,
  signTra,
  soapPost,
} from './arca.ts'

function generateTestCredentials() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 60_000)
  cert.validity.notAfter = new Date(Date.now() + 24 * 3600_000)
  const subject = [
    { name: 'commonName', value: 'zahuy-prueba' },
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'Prueba Ficticia' },
    { name: 'serialNumber', value: 'CUIT 20000000001' },
  ]
  cert.setSubject(subject)
  cert.setIssuer(subject)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
}

test('formatArDateTime usa -03:00', () => {
  assert.equal(formatArDateTime(new Date('2026-11-15T15:00:00Z')), '2026-11-15T12:00:00-03:00')
})

test('buildTra respeta el esquema del WSAA', () => {
  const tra = buildTra(new Date('2026-11-15T15:00:00Z'), 'wsfe', 123)
  assert.match(tra, /<uniqueId>123<\/uniqueId>/)
  assert.match(tra, /<generationTime>2026-11-15T11:50:00-03:00<\/generationTime>/)
  assert.match(tra, /<expirationTime>2026-11-15T12:10:00-03:00<\/expirationTime>/)
  assert.match(tra, /<service>wsfe<\/service>/)
  assert.throws(() => buildTra(new Date(), 'a', 1), ArcaError)
  assert.throws(() => buildTra(new Date(), 'wsfe', -1), ArcaError)
  assert.throws(() => buildTra(new Date(), 'wsfe', 4294967296), ArcaError)
})

test('signTra devuelve un CMS SignedData en Base64 con el TRA y el certificado', () => {
  const { certPem, keyPem } = generateTestCredentials()
  const tra = buildTra(new Date(), 'wsfe', 1)
  for (const digest of ['sha256', 'sha1'] as const) {
    const cms = signTra(tra, certPem, keyPem, digest)
    const der = forge.util.decode64(cms)
    const asn1 = forge.asn1.fromDer(der)
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as unknown as { certificates: unknown[]; rawCapture: { content: unknown } }
    assert.equal(p7.certificates.length, 1)
    assert.ok(der.includes('loginTicketRequest'), 'el CMS incluye el TRA')
  }
  assert.throws(() => signTra(tra, 'no es pem', keyPem), /certificado/)
  assert.throws(() => signTra(tra, certPem, 'no es pem'), /clave privada/)
})

test('buildLoginSoap arma loginCms con in0', () => {
  const soap = buildLoginSoap('QUJD')
  assert.match(soap, /<wsaa:loginCms><wsaa:in0>QUJD<\/wsaa:in0><\/wsaa:loginCms>/)
})

test('parseLoginResponse lee token, sign y vencimiento (XML escapado dentro del SOAP)', () => {
  const ticket =
    '<?xml version="1.0" encoding="UTF-8"?><loginTicketResponse version="1.0"><header><source>cn=wsaahomo</source>' +
    '<destination>cn=x</destination><uniqueId>383953094</uniqueId><generationTime>2026-11-15T12:00:02-03:00</generationTime>' +
    '<expirationTime>2026-11-16T00:00:02-03:00</expirationTime></header><credentials><token>TOKEN+/=</token><sign>SIGN+/=</sign></credentials></loginTicketResponse>'
  const escaped = ticket.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const soap = `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${escaped}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`
  const parsed = parseLoginResponse(soap)
  assert.equal(parsed.token, 'TOKEN+/=')
  assert.equal(parsed.sign, 'SIGN+/=')
  assert.equal(parsed.expirationTime, '2026-11-16T00:00:02-03:00')
})

test('parseLoginResponse convierte el SOAP Fault de ARCA en ArcaError con su código', () => {
  const fault =
    '<soapenv:Envelope><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://x">ns1:coe.alreadyAuthenticated</faultcode>' +
    '<faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>'
  assert.throws(
    () => parseLoginResponse(fault),
    (error: unknown) => error instanceof ArcaError && error.code === 'coe.alreadyAuthenticated',
  )
  assert.throws(() => parseLoginResponse('<x/>'), (e: unknown) => e instanceof ArcaError && e.code === 'WSAA_BAD_RESPONSE')
})

test('buildUltimoAutorizadoSoap valida y escapa', () => {
  const soap = buildUltimoAutorizadoSoap({ token: 'a<b', sign: 'c&d', cuit: '20000000001', ptoVta: 12, cbteTipo: 6 })
  assert.match(soap, /<ar:Token>a&lt;b<\/ar:Token><ar:Sign>c&amp;d<\/ar:Sign><ar:Cuit>20000000001<\/ar:Cuit>/)
  assert.match(soap, /<ar:PtoVta>12<\/ar:PtoVta><ar:CbteTipo>6<\/ar:CbteTipo>/)
  const base = { token: 't', sign: 's', cuit: '20000000001', ptoVta: 1, cbteTipo: 6 }
  assert.throws(() => buildUltimoAutorizadoSoap({ ...base, cuit: '123' }), ArcaError)
  assert.throws(() => buildUltimoAutorizadoSoap({ ...base, ptoVta: 0 }), ArcaError)
  assert.throws(() => buildUltimoAutorizadoSoap({ ...base, ptoVta: 99999 }), ArcaError)
  assert.throws(() => buildUltimoAutorizadoSoap({ ...base, cbteTipo: 0 }), ArcaError)
})

test('parseUltimoAutorizadoResponse: respuesta con número', () => {
  const xml =
    '<soap:Envelope><soap:Body><FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>' +
    '<PtoVta>12</PtoVta><CbteTipo>6</CbteTipo><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>'
  assert.deepEqual(parseUltimoAutorizadoResponse(xml), { ptoVta: 12, cbteTipo: 6, cbteNro: 41, errors: [], events: [] })
})

test('parseUltimoAutorizadoResponse: errores y eventos', () => {
  const xml =
    '<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>5</PtoVta><CbteTipo>6</CbteTipo><CbteNro>0</CbteNro>' +
    '<Errors><Err><Code>11002</Code><Msg>Debe ser un punto de venta habilitado</Msg></Err></Errors>' +
    '<Events><Evt><Code>1</Code><Msg>Aviso</Msg></Evt></Events></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>'
  const parsed = parseUltimoAutorizadoResponse(xml)
  assert.deepEqual(parsed.errors, [{ code: '11002', msg: 'Debe ser un punto de venta habilitado' }])
  assert.deepEqual(parsed.events, [{ code: '1', msg: 'Aviso' }])
  assert.equal(parsed.cbteNro, 0)
})

test('parseDummyResponse', () => {
  const xml =
    '<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>'
  assert.deepEqual(parseDummyResponse(xml), { appServer: 'OK', dbServer: 'OK', authServer: 'OK' })
  assert.throws(() => parseDummyResponse('<x/>'), ArcaError)
})

test('soapPost rechaza cualquier URL que no sea una dirección oficial conocida', async () => {
  let called = false
  const fakeFetch = (() => {
    called = true
    return Promise.resolve(new Response('x'))
  }) as unknown as typeof fetch
  for (const url of ['https://example.com/wsfev1/service.asmx', 'http://wsaa.afip.gov.ar/ws/services/LoginCms', 'https://wsaa.afip.gov.ar.evil.test/x']) {
    await assert.rejects(() => soapPost(url, '', '<x/>', fakeFetch), (e: unknown) => e instanceof ArcaError && e.code === 'URL_NOT_ALLOWED')
  }
  assert.equal(called, false)
  assert.match(WSAA_HOMO_URL, /wsaahomo/)
})

test('arcaUrls: homologación por defecto y producción solo si se pide', () => {
  assert.deepEqual(arcaUrls(), { wsaa: WSAA_HOMO_URL, wsfe: WSFE_HOMO_URL })
  assert.deepEqual(arcaUrls('homologacion'), { wsaa: WSAA_HOMO_URL, wsfe: WSFE_HOMO_URL })
  assert.deepEqual(arcaUrls('produccion'), { wsaa: WSAA_PROD_URL, wsfe: WSFE_PROD_URL })
  assert.ok(WSAA_PROD_URL.startsWith('https://wsaa.afip.gov.ar/'))
  assert.ok(WSFE_PROD_URL.startsWith('https://servicios1.afip.gov.ar/'))
  assert.throws(() => arcaUrls('staging' as never), (e: unknown) => e instanceof ArcaError && e.code === 'INVALID_ENVIRONMENT')
})

test('sin pedir ambiente, las llamadas van a homologación; con produccion, a producción', async () => {
  const urls: string[] = []
  const fakeFetch = ((url: string) => {
    urls.push(url)
    return Promise.resolve(new Response('<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>'))
  }) as unknown as typeof fetch
  await callDummy(fakeFetch)
  await callDummy(fakeFetch, 'produccion')
  assert.deepEqual(urls, [WSFE_HOMO_URL, WSFE_PROD_URL])
})

test('soapPost deja pasar el SOAP Fault (HTTP 500) para que se interprete', async () => {
  const fakeFetch = (() =>
    Promise.resolve(new Response('<Fault><faultcode>ns:cms.cert.untrusted</faultcode><faultstring>no confiable</faultstring></Fault>', { status: 500 }))) as unknown as typeof fetch
  const text = await soapPost(WSAA_HOMO_URL, '', '<x/>', fakeFetch)
  assert.throws(() => parseLoginResponse(text), (e: unknown) => e instanceof ArcaError && e.code === 'cms.cert.untrusted')
})
