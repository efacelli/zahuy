// Lógica pura para hablar con ARCA (ex AFIP) en HOMOLOGACIÓN: WSAA y WSFEv1.
//
// Fuentes oficiales (leídas el 2026-11-15):
//   - Especificación técnica WSAA 1.2.2: https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf
//   - Manual del desarrollador WSFEv1 (RG 4291, v4.7): https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
//
// SOLO HOMOLOGACIÓN. Las URL de producción no existen en este archivo a propósito:
// pasar a producción es una decisión aparte, con revisión del contador (CLAUDE.md).
// Este módulo no lee variables de entorno, no imprime nada y no guarda secretos.
import forge from 'node-forge'

export const WSAA_HOMO_URL = 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms'
export const WSFE_HOMO_URL = 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'
const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/'
const WSAA_NS = 'http://wsaa.view.sua.dvadac.desein.afip.gov'

/** Códigos de comprobante del manual WSFEv1: Factura A, B y C. */
export const CBTE_TIPOS = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' } as const

export class ArcaError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArcaError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Utilidades XML (el documento oficial usa XML simple; no hace falta un parser)
// ---------------------------------------------------------------------------

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Contenido del primer elemento `<name>` (con o sin prefijo de espacio de nombres). */
export function xmlTag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`))
  return m ? m[1] : null
}

/** Contenido de todos los elementos `<name>`. */
export function xmlTags(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g')
  return [...xml.matchAll(re)].map((m) => m[1])
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// WSAA: ticket de requerimiento (TRA) firmado en CMS
// ---------------------------------------------------------------------------

/** Fecha con zona fija -03:00 (Argentina), formato `xsd:dateTime`. */
export function formatArDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  return shifted.toISOString().replace(/\.\d{3}Z$/, '-03:00')
}

/**
 * LoginTicketRequest.xml. `generationTime` 10 minutos atrás y `expirationTime`
 * 10 minutos adelante: la especificación acepta hasta 24 h de diferencia en
 * ambos sentidos, y así un reloj levemente desfasado no rompe el pedido.
 */
export function buildTra(now: Date, service: string, uniqueId: number): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(service)) throw new ArcaError('INVALID_SERVICE', 'Nombre de servicio inválido')
  if (!Number.isInteger(uniqueId) || uniqueId < 0 || uniqueId > 4294967295) {
    throw new ArcaError('INVALID_UNIQUE_ID', 'uniqueId debe ser un entero de 32 bits sin signo')
  }
  const generation = formatArDateTime(new Date(now.getTime() - 10 * 60 * 1000))
  const expiration = formatArDateTime(new Date(now.getTime() + 10 * 60 * 1000))
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generation}</generationTime>` +
    `<expirationTime>${expiration}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
  )
}

/**
 * Firma el TRA: CMS "SignedData" que incluye el XML, la firma RSA y el
 * certificado X.509 (el WSAA lo toma del propio CMS). Devuelve Base64 del DER.
 * La especificación nombra SHA1+RSA; se usa SHA-256 por defecto y SHA-1 si se
 * pide expresamente (ver README: se confirma contra el servicio con un
 * certificado de homologación real).
 */
export function signTra(tra: string, certPem: string, keyPem: string, digest: 'sha256' | 'sha1' = 'sha256'): string {
  let certificate: forge.pki.Certificate
  let privateKey: forge.pki.PrivateKey
  try {
    certificate = forge.pki.certificateFromPem(certPem)
  } catch {
    throw new ArcaError('INVALID_CERTIFICATE', 'El certificado no es un PEM válido')
  }
  try {
    privateKey = forge.pki.privateKeyFromPem(keyPem)
  } catch {
    throw new ArcaError('INVALID_PRIVATE_KEY', 'La clave privada no es un PEM válido')
  }

  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  p7.addCertificate(certificate)
  p7.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: digest === 'sha1' ? forge.pki.oids.sha1 : forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign()
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes())
}

export function buildLoginSoap(cmsBase64: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:wsaa="${WSAA_NS}"><soapenv:Header/><soapenv:Body>` +
    `<wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms>` +
    '</soapenv:Body></soapenv:Envelope>'
  )
}

export type TicketDeAcceso = { token: string; sign: string; generationTime: string; expirationTime: string }

/** Convierte un SOAP Fault en `ArcaError` (el código de ARCA va en `faultcode`). */
export function parseSoapFault(xml: string): ArcaError | null {
  const faultString = xmlTag(xml, 'faultstring')
  if (faultString === null) return null
  const faultCode = (xmlTag(xml, 'faultcode') ?? 'soap.fault').replace(/^.*:/, '').trim()
  return new ArcaError(faultCode, unescapeXml(faultString).trim())
}

/** Extrae token y sign de la respuesta de `loginCms` (el XML viene escapado dentro del SOAP). */
export function parseLoginResponse(soapXml: string): TicketDeAcceso {
  const fault = parseSoapFault(soapXml)
  if (fault) throw fault
  const escaped = xmlTag(soapXml, 'loginCmsReturn')
  if (escaped === null) throw new ArcaError('WSAA_BAD_RESPONSE', 'Respuesta de WSAA sin loginCmsReturn')
  const ticket = unescapeXml(escaped)
  const token = xmlTag(ticket, 'token')
  const sign = xmlTag(ticket, 'sign')
  const generationTime = xmlTag(ticket, 'generationTime')
  const expirationTime = xmlTag(ticket, 'expirationTime')
  if (!token || !sign || !generationTime || !expirationTime) {
    throw new ArcaError('WSAA_BAD_RESPONSE', 'El ticket de acceso no trae token, sign o fechas')
  }
  return { token, sign, generationTime, expirationTime }
}

// ---------------------------------------------------------------------------
// WSFEv1
// ---------------------------------------------------------------------------

export function buildDummySoap(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:ar="${WSFE_NS}"><soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>`
  )
}

export type DummyResult = { appServer: string; dbServer: string; authServer: string }

export function parseDummyResponse(xml: string): DummyResult {
  const fault = parseSoapFault(xml)
  if (fault) throw fault
  const appServer = xmlTag(xml, 'AppServer')
  const dbServer = xmlTag(xml, 'DbServer')
  const authServer = xmlTag(xml, 'AuthServer')
  if (appServer === null || dbServer === null || authServer === null) {
    throw new ArcaError('WSFE_BAD_RESPONSE', 'Respuesta de FEDummy incompleta')
  }
  return { appServer, dbServer, authServer }
}

export function buildUltimoAutorizadoSoap(args: {
  token: string
  sign: string
  cuit: string
  ptoVta: number
  cbteTipo: number
}): string {
  if (!/^\d{11}$/.test(args.cuit)) throw new ArcaError('INVALID_CUIT', 'El CUIT debe tener 11 dígitos')
  if (!Number.isInteger(args.ptoVta) || args.ptoVta < 1 || args.ptoVta > 99998) {
    throw new ArcaError('INVALID_PTO_VTA', 'El punto de venta debe estar entre 1 y 99998')
  }
  if (!Number.isInteger(args.cbteTipo) || args.cbteTipo < 1 || args.cbteTipo > 999) {
    throw new ArcaError('INVALID_CBTE_TIPO', 'Tipo de comprobante inválido')
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:ar="${WSFE_NS}"><soapenv:Header/><soapenv:Body><ar:FECompUltimoAutorizado>` +
    `<ar:Auth><ar:Token>${escapeXml(args.token)}</ar:Token><ar:Sign>${escapeXml(args.sign)}</ar:Sign>` +
    `<ar:Cuit>${args.cuit}</ar:Cuit></ar:Auth><ar:PtoVta>${args.ptoVta}</ar:PtoVta>` +
    `<ar:CbteTipo>${args.cbteTipo}</ar:CbteTipo></ar:FECompUltimoAutorizado></soapenv:Body></soapenv:Envelope>`
  )
}

export type UltimoAutorizado = {
  ptoVta: number
  cbteTipo: number
  cbteNro: number | null
  errors: { code: string; msg: string }[]
  events: { code: string; msg: string }[]
}

function parseCodeMsgList(block: string | null, item: string): { code: string; msg: string }[] {
  if (!block) return []
  return xmlTags(block, item).map((entry) => ({
    code: (xmlTag(entry, 'Code') ?? '').trim(),
    msg: unescapeXml(xmlTag(entry, 'Msg') ?? '').trim(),
  }))
}

export function parseUltimoAutorizadoResponse(xml: string): UltimoAutorizado {
  const fault = parseSoapFault(xml)
  if (fault) throw fault
  const result = xmlTag(xml, 'FECompUltimoAutorizadoResult')
  if (result === null) throw new ArcaError('WSFE_BAD_RESPONSE', 'Respuesta sin FECompUltimoAutorizadoResult')
  const nro = xmlTag(result, 'CbteNro')
  return {
    ptoVta: Number(xmlTag(result, 'PtoVta')),
    cbteTipo: Number(xmlTag(result, 'CbteTipo')),
    cbteNro: nro === null || nro.trim() === '' ? null : Number(nro),
    errors: parseCodeMsgList(xmlTag(result, 'Errors'), 'Err'),
    events: parseCodeMsgList(xmlTag(result, 'Events'), 'Evt'),
  }
}

// ---------------------------------------------------------------------------
// WSFEv1: solicitud de CAE (FECAESolicitar), un comprobante por llamada
// ---------------------------------------------------------------------------

/** Ids de alícuota de IVA del manual WSFEv1 para las tasas que usa el comercio. */
export const IVA_ALICUOTA_IDS = { '10.5': 4, '21': 5 } as const

export type CaeSolicitarArgs = {
  token: string
  sign: string
  cuit: string
  ptoVta: number
  cbteTipo: number
  /** Número que se pide: último autorizado + 1. */
  cbteNro: number
  /** AAAAMMDD, fecha del comprobante (hora de Argentina). */
  cbteFecha: string
  /** 99 = consumidor final sin identificar. */
  docTipo: number
  docNro: number
  /** Condición frente al IVA del receptor (5 = consumidor final). Campo exigido por ARCA. */
  receiverVatConditionId: number
  impTotal: number
  impNeto: number
  impIva: number
  iva: { id: number; baseImp: number; importe: number }[]
}

const cents = (n: number) => Math.round(n * 100)
const money = (n: number) => (cents(n) / 100).toFixed(2)

export function buildCaeSolicitarSoap(args: CaeSolicitarArgs): string {
  if (!/^\d{11}$/.test(args.cuit)) throw new ArcaError('INVALID_CUIT', 'El CUIT debe tener 11 dígitos')
  if (!Number.isInteger(args.ptoVta) || args.ptoVta < 1 || args.ptoVta > 99998) {
    throw new ArcaError('INVALID_PTO_VTA', 'El punto de venta debe estar entre 1 y 99998')
  }
  if (!Number.isInteger(args.cbteTipo) || args.cbteTipo < 1 || args.cbteTipo > 999) {
    throw new ArcaError('INVALID_CBTE_TIPO', 'Tipo de comprobante inválido')
  }
  if (!Number.isInteger(args.cbteNro) || args.cbteNro < 1) throw new ArcaError('INVALID_CBTE_NRO', 'Número de comprobante inválido')
  if (!/^\d{8}$/.test(args.cbteFecha)) throw new ArcaError('INVALID_DATE', 'La fecha debe ser AAAAMMDD')
  if (!Number.isInteger(args.docTipo) || args.docTipo < 0 || !Number.isInteger(args.docNro) || args.docNro < 0) {
    throw new ArcaError('INVALID_DOC', 'Documento del receptor inválido')
  }
  if (!Number.isInteger(args.receiverVatConditionId) || args.receiverVatConditionId < 1) {
    throw new ArcaError('INVALID_VAT_CONDITION', 'Falta la condición frente al IVA del receptor')
  }
  const amounts = [args.impTotal, args.impNeto, args.impIva, ...args.iva.flatMap((a) => [a.baseImp, a.importe])]
  if (amounts.some((n) => !Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)) {
    throw new ArcaError('INVALID_AMOUNTS', 'Los importes deben ser positivos y de hasta 2 decimales')
  }
  if (args.iva.length === 0) throw new ArcaError('INVALID_AMOUNTS', 'Falta el detalle de IVA por alícuota')
  // Se verifican las sumas antes de molestar a ARCA: neto + IVA = total y Σ alícuotas = IVA, base = neto.
  const sumIva = args.iva.reduce((t, a) => t + cents(a.importe), 0)
  const sumBase = args.iva.reduce((t, a) => t + cents(a.baseImp), 0)
  if (cents(args.impNeto) + cents(args.impIva) !== cents(args.impTotal) || sumIva !== cents(args.impIva) || sumBase !== cents(args.impNeto)) {
    throw new ArcaError('INVALID_AMOUNTS', 'Los importes no cierran: neto + IVA = total y las alícuotas deben sumar el neto y el IVA')
  }
  const alicuotas = args.iva
    .map((a) => `<ar:AlicIva><ar:Id>${a.id}</ar:Id><ar:BaseImp>${money(a.baseImp)}</ar:BaseImp><ar:Importe>${money(a.importe)}</ar:Importe></ar:AlicIva>`)
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:ar="${WSFE_NS}"><soapenv:Header/><soapenv:Body><ar:FECAESolicitar>` +
    `<ar:Auth><ar:Token>${escapeXml(args.token)}</ar:Token><ar:Sign>${escapeXml(args.sign)}</ar:Sign>` +
    `<ar:Cuit>${args.cuit}</ar:Cuit></ar:Auth><ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg>` +
    `<ar:PtoVta>${args.ptoVta}</ar:PtoVta><ar:CbteTipo>${args.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    '<ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>1</ar:Concepto>' +
    `<ar:DocTipo>${args.docTipo}</ar:DocTipo><ar:DocNro>${args.docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${args.cbteNro}</ar:CbteDesde><ar:CbteHasta>${args.cbteNro}</ar:CbteHasta>` +
    `<ar:CbteFch>${args.cbteFecha}</ar:CbteFch><ar:ImpTotal>${money(args.impTotal)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${money(args.impNeto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${money(args.impIva)}</ar:ImpIVA>` +
    '<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>' +
    `<ar:CondicionIVAReceptorId>${args.receiverVatConditionId}</ar:CondicionIVAReceptorId>` +
    `<ar:Iva>${alicuotas}</ar:Iva></ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>` +
    '</soapenv:Body></soapenv:Envelope>'
  )
}

export type CaeSolicitarResult = {
  /** `A` aprobado, `R` rechazado, `P` parcial. */
  resultado: string
  cae: string | null
  /** AAAAMMDD */
  caeVencimiento: string | null
  cbteNro: number | null
  observations: { code: string; msg: string }[]
  errors: { code: string; msg: string }[]
  events: { code: string; msg: string }[]
}

export function parseCaeSolicitarResponse(xml: string): CaeSolicitarResult {
  const fault = parseSoapFault(xml)
  if (fault) throw fault
  const result = xmlTag(xml, 'FECAESolicitarResult')
  if (result === null) throw new ArcaError('WSFE_BAD_RESPONSE', 'Respuesta sin FECAESolicitarResult')
  const detail = xmlTag(result, 'FECAEDetResponse') ?? ''
  const clean = (value: string | null) => (value === null || value.trim() === '' ? null : value.trim())
  const nro = clean(xmlTag(detail, 'CbteDesde'))
  return {
    resultado: (xmlTag(detail, 'Resultado') ?? xmlTag(result, 'Resultado') ?? '').trim(),
    cae: clean(xmlTag(detail, 'CAE')),
    caeVencimiento: clean(xmlTag(detail, 'CAEFchVto')),
    cbteNro: nro === null ? null : Number(nro),
    observations: parseCodeMsgList(xmlTag(detail, 'Observaciones'), 'Obs'),
    errors: parseCodeMsgList(xmlTag(result, 'Errors'), 'Err'),
    events: parseCodeMsgList(xmlTag(result, 'Events'), 'Evt'),
  }
}

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

/** POST SOAP 1.1. Rechaza cualquier URL que no sea de homologación. */
export async function soapPost(url: string, soapAction: string, body: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (url !== WSAA_HOMO_URL && url !== WSFE_HOMO_URL) {
    throw new ArcaError('NOT_HOMOLOGATION', 'Solo se permite homologación')
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  // Un SOAP Fault llega con HTTP 500: el parser de cada método lo convierte en ArcaError.
  if (!response.ok && !text.includes('faultstring')) {
    throw new ArcaError('HTTP_ERROR', `ARCA respondió HTTP ${response.status}`)
  }
  return text
}

export async function requestAccessTicket(
  args: { certPem: string; keyPem: string; service?: string; digest?: 'sha256' | 'sha1'; now?: Date },
  fetchImpl: typeof fetch = fetch,
): Promise<TicketDeAcceso> {
  const now = args.now ?? new Date()
  const tra = buildTra(now, args.service ?? 'wsfe', Math.floor(now.getTime() / 1000) % 4294967296)
  const cms = signTra(tra, args.certPem, args.keyPem, args.digest ?? 'sha256')
  const xml = await soapPost(WSAA_HOMO_URL, '', buildLoginSoap(cms), fetchImpl)
  return parseLoginResponse(xml)
}

export async function callDummy(fetchImpl: typeof fetch = fetch): Promise<DummyResult> {
  const xml = await soapPost(WSFE_HOMO_URL, `${WSFE_NS}FEDummy`, buildDummySoap(), fetchImpl)
  return parseDummyResponse(xml)
}

export async function callUltimoAutorizado(
  args: { token: string; sign: string; cuit: string; ptoVta: number; cbteTipo: number },
  fetchImpl: typeof fetch = fetch,
): Promise<UltimoAutorizado> {
  const xml = await soapPost(WSFE_HOMO_URL, `${WSFE_NS}FECompUltimoAutorizado`, buildUltimoAutorizadoSoap(args), fetchImpl)
  return parseUltimoAutorizadoResponse(xml)
}

/** Pide el CAE de UN comprobante en HOMOLOGACIÓN. No reintenta: ante un corte se consulta antes de volver a pedir. */
export async function callCaeSolicitar(args: CaeSolicitarArgs, fetchImpl: typeof fetch = fetch): Promise<CaeSolicitarResult> {
  const xml = await soapPost(WSFE_HOMO_URL, `${WSFE_NS}FECAESolicitar`, buildCaeSolicitarSoap(args), fetchImpl)
  return parseCaeSolicitarResponse(xml)
}
