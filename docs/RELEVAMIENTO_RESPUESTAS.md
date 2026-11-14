# Relevamiento · respuestas de la segunda visita

Respuestas del cliente al cuestionario `docs/Relevamiento_Zahuy_segunda_visita.pdf`
(noviembre 2026), su interpretación y el impacto en el contrato de datos.

> El repositorio es **público**: este documento no incluye nombres, CUIT,
> números de comprobante ni importes reales del negocio.

Estado: **respuestas registradas; varias interpretaciones necesitan
confirmación** (sección 3) antes de redactar el contrato v0.4.0.

---

## 1. Respuestas

### Confirmaciones de la primera visita

| # | Tema | Respuesta | Impacto |
|---|---|---|---|
| 1 | Precio de venta e IVA | **Correcto**: se carga el precio **sin IVA**, se elige 21% o 10,5% y el sistema calcula el precio final de góndola **con IVA** | Resuelve P-02. Cambia el significado de `sale_price` (ver 2.1) |
| 1b | Costo | Se carga **sin IVA** | Resuelve P-02 para `cost_price` |
| 2 | Condición fiscal | **Responsable Inscripto** (factura A/B) | Futura facturación ARCA |
| 3 | Vencidos | **Correcto**: se tira, nunca se vende. **Ningún** proveedor retira vencidos | P-15 queda como está |
| 4 | Permisos | **Corrige**: cargar productos, cambiar precios, ajustes, mermas y anular movimientos lo hace **solo el encargado** | **Revierte v0.3.1** (§4.1, §9, P-10). Ver 3.1 |
| 5 | Dashboard | Lo ven **dueño y encargados** | Rol con acceso al dashboard |
| 6 | Alertas | **Correcto** (30/15/7 + vencidos, contador de días, configurables). **Distintas por categoría** | Configuración de alertas por categoría (v0.4.0) |
| 7 | Cajas | **Corrige**: los **empleados no pueden modificar** (las unidades por caja). La conversión sirve **para calcular el stock total** | Ver 2.2 y 3.2 |
| 8 | Stock con cajas | **Stock = sueltas + cajas** (ej.: 24 + 5 × 12 = 84) | Ver 2.2 |

### Lotes y vencimientos

| # | Pregunta | Respuesta | Impacto |
|---|---|---|---|
| 9 | De qué lote sale una salida | **Automático: el que vence primero** (FEFO) | Cambia P-14: el sistema elige el lote (ver 2.3) |
| 10 | Lote y vencimiento al recibir | **Sí, siempre** | — |
| 11 | Qué se controla por vencimiento | **Todos** los productos | Vencimiento obligatorio en la carga (ver 3.4) |

### Productos y códigos

| # | Pregunta | Respuesta | Impacto |
|---|---|---|---|
| 12 | Productos activos | **500 a 2.000** | Volumen chico: paginación de 25 alcanza |
| 13 | Varios códigos de barras por producto | **No** | Un `barcode` por producto, como hoy |
| 14 | Código interno | **No tienen; que lo genere el sistema** | SKU generado automáticamente (ver 2.4) |
| 15 | Pesables | Sí, por kilo con balanza; la etiqueta tiene **precio y peso** | Ver sección 4 (formato de etiqueta) |
| 16 | Stock de fiambres | En **kilos**; **no** registran la merma del fraccionado | Unidad `kg` con decimales, ya soportada |
| 17 | Productos sin código de barras | Se cargan con un **código propio del sistema** | Mismo SKU automático |
| 18 | Productos sin marca | **No hay** | `brand_id` obligatoria, sin "Sin marca" |
| 19 | Duplicados | **No hay control** hoy | El sistema lo evita con SKU y código de barras únicos |
| 20 | Ubicación (depósito, góndola…) | **No** | Nada que agregar |
| 21 | Datos de proveedores | No los tienen; solo les sirve **el día que llegó el pedido** | `suppliers` mínimo; la fecha ya es `received_on` del lote |

### Ingresos, stock y movimientos

| # | Pregunta | Respuesta | Impacto |
|---|---|---|---|
| 22 | Atraso al cargar | **Hasta una semana** | Coincide con P-11 (7 días) |
| 23 | Comprobante y forma de carga | Llega con factura; cargan **producto por producto** | Pantalla de ingreso por producto (ver sección 5) |
| 24 | Consumo interno | **Sí** | Nuevo tipo de movimiento (ver 2.5) |
| 25 | Stock mínimo | Lo define **el encargado**; que quede registrado **qué perfil hizo qué** | Auditoría por usuario (ya prevista) |
| 26 | Stock inicial | **Contar de cero** | Carga inicial por conteo físico |
| 27 | Conteo desde el celular | **Sí** | Módulo de conteo (etapa futura cercana) |

### Uso diario y operación

| # | Pregunta | Respuesta |
|---|---|---|
| 28 | Usuarios y equipos | **4 personas y 4 PC** |
| 29 | Sucursales | Sin marcar (se subrayó "una sola sucursal y un solo depósito") — **confirmar** |
| 30 | 3 problemas principales | Sin respuesta |
| 31 | Reportes imprescindibles | **Stock bajo** y **por vencer** |
| 32 | Canal de alertas | **En el sistema y por WhatsApp** |
| 33 | Éxito en 1–2 meses | Sin respuesta |
| 34 | Presupuesto mensual | Sin respuesta |
| 35 | Tolerancia a caídas | **Medio día** |
| 36 | Acceso de administrador y copias | **Dueño y encargado** |
| 37 | Quién valida la primera versión | "No es importante" |

### Para más adelante (solo anotado)

| # | Pregunta | Respuesta |
|---|---|---|
| 38 | Cajas cobrando a la vez | **2** |
| 39 | Medios de pago | Efectivo, débito, crédito, QR y transferencia |
| 40 | Factura en cada venta | Sin respuesta |
| 41 | Cuenta corriente | **Sí**. Hoy no controlan la deuda; quieren **alertas de deudores configurables** y **bloquear la cuenta** si la deuda es alta |
| 42 | Descuentos por cantidad | **Sí, a partir de 6 unidades y cada 6** (coincide con el ejemplo de `CLAUDE.md`) |
| 43 | Software de caja actual | Propio; no importa exportar sus datos |

Material: se fotografió una etiqueta de balanza y tres comprobantes de compra
(sección 4). No se pidió exportación del catálogo: el stock se cuenta de cero.

---

## 2. Propuesta de cambios para el contrato v0.4.0

### 2.1 Precio sin IVA y precio final

Hoy `sale_price` no define si incluye IVA. Propuesta:

- `sale_price` = **precio de venta sin IVA** (lo que se carga).
- Precio final de góndola = `round(sale_price × (1 + vat_rate / 100), 2)`,
  calculado **en la base** (columna generada `sale_price_with_vat` o en las
  vistas), nunca en React.
- `cost_price` = costo **sin IVA**.
- Margen (para el dashboard) = `sale_price − cost_price`, ambos sin IVA.

### 2.2 Cajas y unidades por caja — una sola fuente de stock

La respuesta 8 (stock = sueltas + cajas) se resuelve **sin contar dos veces**
manteniendo el modelo actual:

- El stock del producto (`v_product_stock.stock_quantity`) sigue siendo la
  suma de los lotes e incluye **todas** las unidades, también las que están
  dentro de cajas cerradas.
- Nueva columna `products.units_per_box integer NOT NULL DEFAULT 12 CHECK (> 0)`.
  Solo el encargado la modifica (respuesta 7).
- `boxes_quantity` sigue siendo el conteo manual de cajas cerradas en depósito
  (lo actualiza un empleado).
- La vista agrega `units_in_boxes = boxes_quantity × units_per_box` y
  `loose_units = stock_quantity − units_in_boxes`, para mostrar
  "84 u. (24 sueltas + 5 cajas de 12)".
- Si `loose_units < 0` (las cajas contadas superan el stock), la vista lo marca
  como **inconsistencia** para revisar; no se corrige solo.
- En el ingreso de mercadería se puede cargar "5 cajas" y el sistema lo
  convierte a unidades con `units_per_box`.

Esto reemplaza la regla de `CLAUDE.md` "no calcular cajas automáticamente":
las cajas se siguen **contando** a mano; lo que se calcula es su equivalente en
unidades.

### 2.3 Salidas por FEFO

- Nueva RPC (por ejemplo `register_product_movement`) que recibe **producto**,
  tipo y cantidad, y descuenta de los lotes con stock **en orden de
  vencimiento**, partiendo la salida en varios movimientos si un lote no
  alcanza. Todo en una transacción e idempotente.
- `register_stock_movement` por lote se mantiene para correcciones puntuales.
- Una merma de vencidos descuenta de los lotes vencidos primero (son los que
  vencen antes).

### 2.4 SKU automático

- `products.sku` lo genera la base con una secuencia, sin intervención del
  usuario. Formato propuesto: **número de 6 dígitos con ceros a la izquierda**
  (`000001`), fácil de tipear en la caja y compatible con el código de 6
  dígitos de la balanza (sección 4).
- `create_product` deja de recibir `p_sku` (o lo acepta nulo).

### 2.5 Consumo interno

- Nuevo valor de `movement_type`: `internal_use` (salida, motivo obligatorio).

### 2.6 Roles

Ver 3.1. Propuesta preliminar: `admin` = dueño, `manager` = encargado,
`staff` = empleado, con la matriz de permisos a definir.

### 2.7 Alertas configurables por categoría

- Tabla de configuración con los días de alerta por defecto (30/15/7) y una
  excepción opcional por categoría. La editan dueño y encargado.
- `expiry_status` pasa a calcularse con esos días en lugar de valores fijos.

---

## 3. Dudas a confirmar con el cliente

1. **Permisos del empleado (respuesta 4).** Si solo el encargado carga
   productos, cambia precios, ajusta, registra mermas y anula, ¿qué hace el
   empleado? Propuesta: consulta, **registra ingresos de mercadería**,
   **consumo interno** y **cuenta cajas**. ¿Ve costos y márgenes? (En la
   primera visita se dijo que sí; esta respuesta lo pone en duda.)
2. **Cajas (respuestas 7 y 8).** Confirmar el modelo de 2.2: el stock incluye
   las unidades de las cajas; las cajas son un conteo de cuántas de esas
   unidades están en cajas cerradas.
3. **FEFO (respuesta 9).** Si la salida supera el primer lote, ¿se toma del
   siguiente automáticamente? (Propuesta: sí.)
4. **Vencimiento obligatorio (respuesta 11).** ¿Existe algún producto que no
   venza (por ejemplo, artículos de limpieza o bazar)? Si no, el vencimiento
   pasa a ser obligatorio en la carga.
5. **SKU (respuesta 14).** ¿Les sirve un número de 6 dígitos?
6. **Sucursales (respuesta 29).** Confirmar una sola sucursal y un solo depósito.
7. **WhatsApp (respuesta 32).** Requiere un proveedor de mensajería con costo
   mensual; queda para después de la Etapa 1 salvo que lo prioricen.

---

## 4. Etiqueta de balanza (para la etapa de caja)

Etiqueta de ejemplo (balanza electrónica): producto, vencimiento, peso, precio
por kilo, importe y código de barras **EAN-13** con este formato:

| Posición | Contenido | Ejemplo |
|---|---|---|
| 1 | Prefijo `2` (código interno de balanza) | `2` |
| 2–7 | Código del producto en la balanza (PLU, 6 dígitos) | `000005` |
| 8–12 | **Peso en gramos** (5 dígitos) | `00245` = 0,245 kg |
| 13 | Dígito verificador | `8` (verificado) |

El código lleva el **peso**, no el importe. En la etapa de ventas, la caja
leerá el PLU y el peso, y calculará el importe con el precio del sistema. Hace
falta guardar el PLU de cada producto pesable (campo futuro, por ejemplo
`products.scale_plu`), o usar el SKU de 6 dígitos como PLU.

## 5. Comprobantes de compra

Llegan tres tipos de comprobante, todos con **una línea por producto** y
cantidades en unidades o kilos:

- **Factura A**: precio unitario **sin IVA**, alícuota por línea (21%) y a veces
  descuento por línea.
- **Comprobante no fiscal (X)**: precio unitario y descuento por línea, sin IVA
  discriminado. Incluye productos por kilo (ej.: queso en kg con decimales).
- **Remito**: solo cantidades, sin precios.

Impacto:

- **Etapa 1**: el ingreso de mercadería solo necesita producto, cantidad, lote y
  vencimiento; el tipo y número de comprobante pueden ir como referencia
  opcional en las notas del movimiento.
- **Etapa de compras (futura)**: registrar el comprobante (tipo, proveedor,
  fecha), costos reales por línea con descuentos, y actualizar `cost_price`.
  Definir con el cliente qué costo se carga cuando el comprobante no discrimina
  IVA.
