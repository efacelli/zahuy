# Facturación electrónica ARCA — relevamiento (etapa 6, sin implementar)

| Campo | Valor |
|---|---|
| Estado | **Relevamiento.** No se implementa nada fiscal hasta tener las respuestas de §2, el visto bueno del contador y la aprobación de `efacelli` |
| Fecha | 2026-11-16 |
| Relación | `CLAUDE.md` (ARCA — futuro), skill `arca-invoicing`, contrato §15.8 |

> Este documento no contiene datos del negocio ni secretos: el CUIT, el punto de
> venta, los certificados y las claves **nunca** van al repositorio (es público).
> Se cargan solo en el entorno seguro del backend.
>
> Las normas citadas en §3 salen de una búsqueda del 2026-11-16 y varias fuentes
> son blogs de proveedores de software. **Hay que confirmarlas en arca.gob.ar y con
> el contador** antes de diseñar el contrato.

## 1. Qué ya está listo en el sistema

- Ventas y caja (§15): cada venta es atómica e idempotente, con ítems, IVA
  discriminado por línea (`net_amount`, `vat_amount`, `vat_rate`), descuentos
  (§16) y pagos. El ticket actual dice **"NO VÁLIDO COMO FACTURA"** (P-27).
- El negocio es **Responsable Inscripto** (P-02): emite A (a otros RI) y B (a
  consumidores finales y monotributistas). La factura C no corresponde.
- Precios sin IVA con IVA 21 % o 10,5 % por producto, y el precio final lo calcula
  la base: es lo que pide un comprobante A/B.

Lo que falta es todo lo fiscal: autorizar cada comprobante ante ARCA y guardar
el CAE.

## 2. Lo que necesitamos del cliente y del contador

Ninguna de estas tareas la puede hacer el equipo de desarrollo: requieren la clave
fiscal del titular.

| # | Pregunta / tarea | Quién | Para qué |
|---|---|---|---|
| A-1 | CUIT y razón social del titular, domicilio fiscal, inicio de actividades, ingresos brutos | Dueño / contador | Encabezado del comprobante |
| A-2 | Confirmar condición frente al IVA (Responsable Inscripto) y actividades | Contador | Letras A/B y alícuotas |
| A-3 | ¿Hoy cómo factura? (controlador fiscal, facturador de ARCA, otro sistema). ¿Desde qué fecha quiere facturar con Zahuy? | Dueño | Transición sin cortar la facturación ni repetir números |
| A-4 | **Dar de alta un punto de venta nuevo** tipo "RECE / Web Services" en ARCA (no reusar el de otro sistema) | Contador con clave fiscal | Numeración propia de Zahuy |
| A-5 | Clave fiscal nivel 3 del titular (o de un administrador de relaciones) para **generar el certificado** y **delegar el servicio `wsfe`** | Dueño / contador | Sin esto el web service rechaza todo (`coe.notAuthorized`) |
| A-6 | Certificado de **homologación** (pruebas) en WSASS, asociado a `wsfe` | Contador o desarrollador con la clave del titular | Probar sin emitir comprobantes reales |
| A-7 | ¿Factura a todos los clientes o solo a quien la pide? ¿Factura cada venta (B a consumidor final) o solo algunas? | Dueño + contador | Define si el cobro emite comprobante siempre |
| A-8 | ¿Vende a empresas (factura A) seguido? ¿Con cuenta corriente? | Dueño | Datos del receptor (CUIT, condición IVA) en la caja |
| A-9 | Notas de crédito: ¿cómo se devuelve hoy? Una venta anulada después de facturada necesita **nota de crédito**, no se borra | Contador | Reemplaza la anulación (§15) cuando hay comprobante |
| A-10 | Contingencia: si ARCA no responde, ¿se cobra igual y se factura después? ¿Usar **CAEA**? | Contador | Diseño del modo sin conexión (CLAUDE.md, offline) |
| A-11 | Impresión: ¿ticket térmico (80 mm) o A4? Datos obligatorios del pie (CAE, vencimiento, QR) | Dueño | Formato del comprobante; se cruza con la impresora del issue #68 |

## 3. Normas a confirmar (búsqueda del 2026-11-16)

| Tema | Lo que dicen las fuentes | Impacto |
|---|---|---|
| Condición frente al IVA del **receptor** (RG 5616) | Obligatoria; según fuentes recientes, desde el **1/12/2026** el web service **rechaza** comprobantes sin ese dato | La caja tiene que pedir o asumir la condición del cliente (consumidor final por defecto) |
| Identificar al consumidor final | DNI/CUIL/CDI obligatorio desde **$ 10.000.000** por comprobante (RG 5700/2025); un tope anterior más bajo figura en fuentes viejas | Pedir documento solo arriba del tope |
| Factura M | Eliminada (RG 5762/2025): factura A con leyenda | No implementar M |
| Cronograma y obligados | Actualizado por RG 5866/2026 | Confirmar con el contador |
| Numeración | Estrictamente correlativa por punto de venta y tipo | Un solo emisor por punto de venta; la base serializa |

## 4. Diseño técnico propuesto (a validar con el backend)

1. **Nada fiscal en React.** El certificado y la clave privada viven solo en el
   backend (Supabase Edge Function con secretos, o un servicio aparte). El
   navegador nunca ve el certificado, el token de WSAA ni la clave.
2. **WSAA**: el backend firma el pedido de acceso (TRA) con el certificado, obtiene
   el token y la firma (válidos unas 12 horas) y los reutiliza mientras sirvan.
3. **WSFEv1**: por cada comprobante, `FECompUltimoAutorizado` para el número y
   `FECAESolicitar` para autorizarlo. Se guarda pedido, respuesta, **CAE**,
   vencimiento del CAE, punto de venta, tipo, número y estado.
4. **Idempotencia y conciliación**: una venta se factura **una sola vez**. Si la
   respuesta se pierde, antes de reintentar se consulta (`FECompConsultar`) si el
   número ya quedó autorizado. Estados: borrador, pendiente, autorizado,
   rechazado, contingencia.
5. **Separado de la venta**: la venta (stock y caja) se confirma como hoy; la
   factura es un paso aparte que puede fallar y reintentarse sin tocar el stock.
   Una venta offline o pendiente **no es** una factura autorizada.
6. **Homologación primero**, con un proyecto separado (staging) y el certificado
   de pruebas; recién después producción, con aprobación explícita.

El contrato de datos (tablas de comprobantes, estados, RPC) se propone recién con
las respuestas de §2, en un PR aparte para `ChinoNader18`.

## 5. Orden sugerido

1. Responder §2 (A-1 a A-11) con el dueño y el contador.
2. Contador: punto de venta Web Services y certificado de homologación (A-4 a A-6).
3. Propuesta de contrato (comprobantes, notas de crédito, contingencia).
4. Backend: Edge Function contra homologación, con pruebas.
5. Caja: elegir A/B, datos del receptor, comprobante con CAE y QR.
6. Producción: certificado real, aprobación de `efacelli`, primera factura controlada.

## Fuentes consultadas

- ARCA, documentación de web services: [WSAA](https://www.afip.gob.ar/ws/documentacion/wsaa.asp), [factura electrónica](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp), [especificación técnica WSAA](https://www.arca.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf), [manual del desarrollador WSFEv1](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf), [acciones para consumir el web service](https://www.afip.gob.ar/fe/documentos/AccionesarealizarparaconsumirunWebservicedeFacturaElectr.pdf).
- Normativa (a confirmar): [iProfesional sobre RG 5616](https://www.iprofesional.com/impuestos/464104-nuevo-requisito-arca-puede-trabar-emision-facturas), [Olivé Di Paolo sobre RG 5616](https://olivedipaolo.com/sitio/2026/10/02/rg-5616-condicion-de-iva-obligatoriedad-y-control-de-arca/), [Facturel, normativa 2026](https://facturel.com.ar/normativa-facturacion-electronica-arca.html), [Contablix, topes 2026](https://contablix.ar/blog/factura-electronica-argentina-2026).
