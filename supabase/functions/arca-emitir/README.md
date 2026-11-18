# arca-emitir — emite la factura electrónica de una venta (solo homologación)

Contrato §22.3. **Solo HOMOLOGACIÓN**: con el ambiente fiscal en `produccion` responde `501`
(`PRODUCTION_NOT_IMPLEMENTED`) y con `off` responde `409`. Pasar a producción es una decisión aparte
(revisión del contador, backup verificado y orden explícita), no un cambio de configuración.

## Uso

`POST /functions/v1/arca-emitir` con la sesión del usuario (`Authorization: Bearer <JWT>`):

```json
{ "sale_id": "<uuid>", "idempotency_key": "<uuid>", "receiver": { "docType": 99, "docNumber": "0", "vatConditionId": 5 } }
```

- `receiver` es opcional. Por defecto: consumidor final sin identificar (Factura B). Con condición de IVA
  de responsable inscripto o monotributo y CUIT del receptor, emite **Factura A** (la clase la dicta ARCA).
  Desde $10.000.000 hay que identificar al comprador.
- **Repetir con la misma `idempotency_key` es seguro**: devuelve el mismo comprobante y no emite otro.
  Una venta tiene un solo comprobante vivo.
- Respuestas: `200` autorizada (con CAE y vencimiento) · `202` en curso (volver a llamar con la **misma
  clave** en unos segundos) · `422` rechazada por ARCA (se puede volver a emitir) · `401` sin sesión ·
  `403` sin permiso sobre la venta · `404/409/4xx` otros errores de negocio.
- Importe del comprobante = **lo cobrado** (total + redondeo de efectivo); el IVA por alícuota se
  recalcula en la base (§22.4).

## Cómo funciona (resumen)

1. Verifica la sesión, que el usuario esté activo y que pueda ver la venta (la RLS decide).
2. Toma el ticket de ARCA guardado en la base (`fiscal_ticket_get`); si no hay, lo pide y lo guarda.
   ARCA **no entrega otro mientras el anterior siga vigente**.
3. Pregunta a ARCA el último número autorizado y llama a `fiscal_begin` (reserva el número, idempotente).
4. `fiscal_claim` deja pasar a **una sola** llamada a enviar el comprobante (`FECAESolicitar`).
5. Cierra con `fiscal_finish`: `authorized` (CAE), `rejected` (ARCA lo dijo) o `unknown`.
6. Si ARCA **no responde**, el documento queda `unknown` y **no se reenvía**. Pasados ~2 minutos, la
   siguiente llamada **concilia**: consulta a ARCA (`FECompConsultar`); si lo tiene con el mismo importe lo
   autoriza con su CAE, y si ARCA confirma que ese número no existe lo da por rechazado.

## Secretos (nunca en el repo)

`ARCA_CUIT`, `ARCA_CERT_PEM`, `ARCA_KEY_PEM` (certificado y clave **de homologación**, en una línea con `\n`
literales) y opcional `ARCA_DIGEST` (`sha256` por defecto). Ver `.env.example` de `arca-homologacion`.
`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase. El certificado y la
clave nunca se devuelven ni se registran; tampoco el token ni la firma.

Desplegarla es un paso 🔒 de `docs/DEPLOY.md`: lo hace una persona, y solo en el proyecto de **staging**.

## Pruebas

```bash
npm install --no-save node-forge@1.3.1
node --test supabase/functions/arca-emitir/emitir_test.ts supabase/functions/arca-homologacion/arca_test.ts supabase/functions/arca-homologacion/arca_cae_test.ts supabase/functions/arca-homologacion/arca_consult_test.ts
```

`emitir_test.ts` (29 pruebas) usa dependencias simuladas: camino feliz, sin secretos, reintentos, reserva de
envío, rechazo, corte sin respuesta (`unknown`), conciliación (mismo importe, otro importe, no existe,
consulta fallida), ambientes, umbral de identificación, ticket y selección de Factura A o B.

## Lo que se verificó y lo que no

Verificado (2026-11-17), con la base local y ARCA de **homologación** reales (certificado emitido por ARCA),
cargando `index.ts` en Node: sin sesión `401`, pedido inválido `400`, otra empleada `403`; Factura B de
$1.210 autorizada y confirmada por consulta a ARCA; repetirla devuelve el mismo comprobante; venta cobrada
$1.200 de $1.210 → factura por $1.200 (neto 991,74 + IVA 208,26); venta con 21 % y 10,5 % cobrada $2.300 →
neto 1.987,04 + IVA 312,96; conciliación de un documento colgado que ARCA no tiene → rechazado y número
reutilizado; producción `501`; apagada `409`; ningún token en la base ni en las respuestas.

**No verificado:** el `index.ts` dentro del *runtime* de funciones de Supabase (Deno). En esta máquina el
contenedor no pudo bajar `node-forge` de npm (error de certificado TLS de la red), así que se probó con un
reemplazo mínimo de `Deno.serve`. Tampoco: corte de red real a mitad de un envío (solo simulado),
notas de crédito, CAEA ni producción.
