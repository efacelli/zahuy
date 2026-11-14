# Relevamiento en el autoservicio — preguntas para nuestro sistema

Complementa el cuestionario general (`cuestionario_relevamiento_autoservicio.pdf`).
Como el objetivo es **reemplazar** el sistema actual, no integrarlo, estas
preguntas apuntan a lo que necesitamos decidir para **nuestro** sistema. Cada
una indica qué parte del contrato (`docs/DATA_CONTRACT.md`) o de la app resuelve.

Del PDF, la sección 1 (API, webhooks, exportaciones del POS actual) pierde
prioridad. Lo que sí conviene conseguir del sistema actual es el **catálogo
exportado** para la carga inicial (sección E).

Anotar las respuestas acá mismo o en el PDF, y después pasarlas al contrato.

---

## A. Decisiones que hoy están pendientes o provisionales (prioridad máxima)

| # | Pregunta | Resuelve |
|---|---|---|
| A1 | El precio de venta que ven en góndola, ¿incluye IVA? El costo que cargan, ¿es con o sin IVA? | P-02 (cómo se rotulan precios y márgenes) |
| A2 | ¿El negocio es Responsable Inscripto o Monotributista? (si no saben, anotar el contacto del contador) | P-02 y la futura facturación (A/B o C) |
| A3 | Cuando un producto se vence: ¿se tira, se devuelve al proveedor, se vende con descuento? ¿Se puede vender algo vencido en algún caso? | P-15 |
| A4 | ¿Quiénes van a usar el sistema y qué puede hacer cada uno? En especial: crear productos, cambiar precios, hacer ajustes de stock, registrar mermas, anular un movimiento mal cargado. | P-10 (roles) |
| A5 | ¿Un empleado puede ver el costo y el margen, o solo el precio de venta? | P-10 (RLS de columnas) |
| A6 | ¿Cargan la mercadería el mismo día que llega o días después? ¿Cuántos días de atraso como máximo? | P-11 |
| A7 | Las alertas de 30, 15 y 7 días, ¿les sirven? ¿Quieren también "vence en 2 días" o "vence hoy"? ¿Cambia según la categoría (lácteos vs. secos)? | §4.4 (alertas) |
| A8 | Al sacar mercadería, ¿prefieren elegir el lote o que el sistema tome solo el que vence primero? | P-14 (FEFO) |

## B. Cómo se arma un producto

| # | Pregunta | Resuelve |
|---|---|---|
| B1 | ¿Un mismo producto puede tener más de un código de barras (distintos proveedores, presentaciones)? | Hoy el contrato admite **un** código por producto; si son varios, hace falta otra tabla |
| B2 | ¿Compran por caja y venden por unidad? ¿Quieren que el sistema convierta (1 caja = 12 u.) o prefieren cargar cajas y unidades por separado como pidieron? | `boxes_quantity` manual vs. conversión |
| B3 | ¿Qué cuentan exactamente como "cajas"? ¿Cajas cerradas en depósito? ¿Quién las actualiza y cuándo? | Significado de `boxes_quantity` |
| B4 | Fiambres y quesos: ¿se venden por kilo con balanza? ¿La etiqueta de la balanza tiene un código con precio o peso? (sacar foto de una etiqueta, sin datos sensibles) | Unidad `kg` y futura venta por peso |
| B5 | Fiambres: ¿quieren controlar el stock por pieza/horma en kilos? ¿Registran la merma del fraccionado? | Lotes en kg y mermas |
| B6 | ¿Tienen hoy un código interno por producto? ¿Con qué formato? ¿O lo generamos nosotros? | P-05 (SKU) |
| B7 | ¿Qué categorías usan? ¿Hay productos sin marca (sueltos, fraccionados)? | Catálogos y "Sin marca" (P-06) |
| B8 | ¿Necesitan saber dónde está cada producto (depósito, góndola, heladera, freezer)? | Hoy no está en el contrato |
| B9 | ¿Cuántos proveedores tienen y qué datos les sirven (CUIT, contacto, días de pedido o entrega)? | Tabla `suppliers` |

## C. Stock y movimientos

| # | Pregunta | Resuelve |
|---|---|---|
| C1 | ¿Hay consumo interno, regalos o degustaciones que haya que descontar? | Hoy no hay un tipo de movimiento para eso |
| C2 | Cuando llega un pedido, ¿viene con factura o remito? ¿Prefieren cargar el remito entero de una vez (varios productos) en vez de producto por producto? | Pantalla de recepción |
| C3 | ¿Cada cuánto hacen inventario físico? ¿Les sirve contar desde el celular y que el sistema muestre las diferencias? | Futuro módulo de conteo |
| C4 | ¿Quién define el stock mínimo de cada producto? | `min_stock` y reposición |

## D. Uso diario

| # | Pregunta | Resuelve |
|---|---|---|
| D1 | ¿Cuántas personas lo van a usar y desde qué equipos (PC del mostrador, tablet en depósito, celulares propios)? | Prioridad de diseño (escritorio vs. celular) |
| D2 | ¿El internet del local es estable? ¿En el depósito hay señal? | Modo offline (etapa futura) |
| D3 | ¿Qué quiere ver el dueño al abrir la app cada mañana? | Dashboard |
| D4 | ¿Cuáles son los 3 problemas que más plata o tiempo les hacen perder hoy (vencidos que se tiran, faltantes, errores de precio…)? | Prioridades de la primera versión |
| D5 | ¿Quieren recibir alertas por WhatsApp o email, o alcanza con verlas en la app? | Notificaciones |

## E. Datos para arrancar (pedir)

- Exportación del catálogo actual (Excel/CSV), aunque sea parcial: para planificar la **carga inicial**.
- Foto de 3 a 5 etiquetas de balanza y de una factura o remito de proveedor (tapando datos sensibles).
- Lista de categorías que hoy controlan por vencimiento.
- Quién va a probar la primera versión y validar que los números estén bien.

No anotar contraseñas ni datos personales de clientes.

## F. Para etapas futuras (solo anotar, no decidir)

Como el sistema va a reemplazar también la caja más adelante:

- ¿Cuántas cajas cobran al mismo tiempo?
- ¿Qué medios de pago aceptan (efectivo, débito, crédito, QR, transferencia)?
- ¿Emiten factura electrónica en cada venta o solo cuando la piden?
- ¿Venden a cuenta corriente? ¿A cuántos clientes, y cómo controlan la deuda?
- ¿Hacen descuentos por cantidad? ¿Para qué productos?
