# arca-homologacion — función de PRUEBA de ARCA (solo homologación)

Etapa 6 (facturación ARCA), **fase de investigación**. Esta función demuestra que
el backend puede:

1. Obtener un **ticket de acceso** del WSAA (autenticación) con un certificado de
   homologación.
2. Consultar **`FECompUltimoAutorizado`** de WSFEv1 (último comprobante autorizado
   de un punto de venta y tipo).

No emite comprobantes, no pide CAE, no toca la base de datos de negocio y **no
funciona contra producción**: las dos URL están fijas a homologación en
[`arca.ts`](arca.ts) y `soapPost` rechaza cualquier otra. Pasar a producción es
una decisión aparte (certificado propio, contador, aprobación explícita).

## Qué verifica quien la llama

Solo un usuario **activo con rol `admin`** (el dueño). La función comprueba el JWT
y el perfil en la base; no confía en el cliente. Sin sesión o con otro rol →
`403 NOT_AUTHORIZED`. Nunca devuelve ni registra el token, el sign, el certificado
ni la clave: la respuesta trae solo el vencimiento del ticket y el resultado de
ARCA.

## Uso

```
POST /functions/v1/arca-homologacion      (Authorization: Bearer <JWT del dueño>)
{ "action": "dummy" }     # FEDummy: estado de WSFEv1. No necesita certificado
{ "action": "ultimo" }    # WSAA + FECompUltimoAutorizado (por defecto)
```

Respuesta de `ultimo` (ejemplo):

```json
{ "ok": true, "environment": "homologacion", "action": "ultimo",
  "ticket_expires_at": "2026-11-16T00:00:02-03:00",
  "cbte_tipo_nombre": "Factura B",
  "result": { "ptoVta": 1, "cbteTipo": 6, "cbteNro": 0, "errors": [], "events": [] } }
```

Los errores de ARCA vuelven como `{ ok:false, code, message }` con el código
oficial (por ejemplo `cms.cert.untrusted`, `coe.alreadyAuthenticated`,
`coe.notAuthorized`).

## Secretos (nunca en el repo)

Se definen **fuera de Git**: en local, en un archivo `.env` ignorado por Git a
partir de [`.env.example`](.env.example); en Supabase, como secretos de la
función. Variables: `ARCA_CUIT`, `ARCA_CERT_PEM`, `ARCA_KEY_PEM` (PEM en una línea
con `\n` literales), `ARCA_PTO_VTA`, `ARCA_CBTE_TIPO` (1 Factura A, 6 B, 11 C) y
`ARCA_DIGEST` (`sha256` por defecto o `sha1`).

```bash
npx supabase@3.1.0 functions serve arca-homologacion --env-file supabase/functions/arca-homologacion/.env
```

(En Supabase en la nube: `npx supabase@3.1.0 secrets set --env-file <archivo>` y
`functions deploy arca-homologacion`. Es un paso 🔒 de `docs/DEPLOY.md`: lo hace
una persona, y solo en el proyecto de **staging**.)

## Cómo conseguir el certificado de homologación (lo hace una persona)

Según la documentación oficial (WSASS, ver Fuentes):

1. Ingresar con **clave fiscal de una persona física** y adherir el servicio
   **WSASS** desde el *Administrador de Relaciones de Clave Fiscal*.
2. En la computadora, generar la clave privada y el pedido de certificado (CSR) con
   OpenSSL. El `serialNumber` es `CUIT ` + 11 dígitos:

   ```bash
   openssl genrsa -out MiClavePrivada.key 2048
   openssl req -new -key MiClavePrivada.key -subj "/C=AR/O=<razón social>/CN=zahuy-homologacion/serialNumber=CUIT <11 dígitos>" -out MiPedido.csr
   ```

3. En WSASS: *Nuevo certificado* (se pega el CSR y se obtiene el `.crt`), y luego
   *Crear autorización a servicio* para el servicio de facturación (`wsfe`)
   indicando la CUIT representada. El nombre exacto del servicio y los pasos de
   cada pantalla hay que confirmarlos en el manual WSASS al hacerlo.
4. Habilitar un **punto de venta** de prueba para WSFEv1 (es un trámite de ARCA;
   la documentación leída no lo detalla).

La clave privada (`.key`) y el certificado (`.crt`) quedan **solo en el gestor de
secretos del dueño**; el repo los ignora (`*.key`, `*.crt`, `*.pem`, `.env*`).

## Lo que se verificó y lo que no

Verificado (2026-11-15):

- 12 pruebas unitarias (`arca_test.ts`): armado del TRA, firma CMS (el CMS firmado
  se verificó además con `openssl cms -verify`), SOAP de `loginCms`, `FEDummy` y
  `FECompUltimoAutorizado` (con los ejemplos del manual), lectura de respuestas y
  *SOAP Faults*, y rechazo de URL de producción.
- **En el entorno real de homologación** (sin certificado de ARCA): `FEDummy`
  respondió `AppServer/DbServer/AuthServer = OK`. Con un certificado ficticio
  autofirmado, el WSAA de homologación **procesó el CMS** y lo rechazó solo por
  `cms.cert.untrusted`, que es la respuesta esperada para un certificado que ARCA
  no emitió. Corrió también dentro del *runtime* de funciones de Supabase (Deno).
- Control de acceso: sin sesión y con rol encargado → `403`; dueño → `200`.

**Verificado con un certificado real de homologación emitido por ARCA (2026-11-17)**,
corriendo este mismo módulo desde Node (sin tocar producción):

- El WSAA acepta la firma **`sha256`** y entrega el ticket de acceso (vigencia ~12 h).
- Sin la *autorización a servicio* (`wsfe`) el WSAA responde `coe.notAuthorized`.
- `FECompUltimoAutorizado` con credenciales válidas para el punto de venta de
  prueba y comprobante B: responde sin errores.
- **`FECAESolicitar`** (`callCaeSolicitar`): una Factura B de consumidor final con IVA
  21 % y otra con **21 % y 10,5 % juntos** volvieron con resultado `A`, CAE y
  vencimiento (10 días), con número consecutivo (el último autorizado subió de a uno).
  El campo `CondicionIVAReceptorId` (5 = consumidor final) va en la solicitud.
- Importes que no cierran (neto + IVA ≠ total, o alícuotas que no suman) se rechazan
  **antes** de llamar a ARCA (`INVALID_AMOUNTS`).
- **El ticket no se puede pedir de nuevo mientras esté vigente**: ARCA responde
  `coe.alreadyAuthenticated` ("El CEE ya posee un TA valido") y no hay forma de
  forzarlo antes del vencimiento (en la prueba hubo que usar otro certificado y otro
  alias). Hoy la función lo guarda solo en la memoria de la instancia; una
  implementación de verdad **debe guardar el ticket en una tabla con acceso solo
  para el servidor** (ver §22 del contrato).

**No verificado:**

- Comprobantes de **producción** (esta función solo habla con homologación).
- Rechazos reales de ARCA por observaciones (el parser se probó con XML fabricado).
- Notas de crédito, Factura A con CUIT receptor, `FECompConsultar` y CAEA.

## Pruebas

`arca_test.ts` usa `node:test`, que corre con Deno y con Node. Con Node 22 o
posterior, sin tocar `package.json`:

```bash
npm install --no-save node-forge@1.3.1
node --test supabase/functions/arca-homologacion/arca_test.ts supabase/functions/arca-homologacion/arca_cae_test.ts
```

`arca_cae_test.ts` cubre `FECAESolicitar` (SOAP, validación de importes, aprobado,
rechazado, errores y *SOAP Fault*). No hace llamadas de red.

## Fuentes oficiales (leídas el 2026-11-15)

- WSAA — [Especificación técnica 1.2.2](https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf): TRA, CMS, `loginCms`, errores, ticket de 12 h; endpoint de homologación `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`.
- WSFEv1 — [Manual del desarrollador v4.7 (RG 4291)](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf): `FEDummy`, `FECompUltimoAutorizado`, códigos de comprobante (1/6/11); homologación `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`. La página de homologación externa enlaza una v4.8: revisar cuál aplica antes de implementar.
- WSASS — [Manual](https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf) y [página de certificados](https://www.afip.gob.ar/ws/documentacion/certificados.asp).
