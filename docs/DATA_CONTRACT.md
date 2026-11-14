# Contrato de datos — Etapa 1

| Campo | Valor |
|---|---|
| Versión | 0.4.0 |
| Estado | **PROPUESTO — PENDIENTE DE CONCORDANCIA DEL BACKEND** |
| Alcance | Productos, lotes, vencimientos, stock y movimientos |
| Fuentes | `CLAUDE.md`, skills `supabase-database`, `inventory-domain`, `security-rls`, `testing-migrations`, `docs/RELEVAMIENTO_RESPUESTAS.md` |

> **v0.4.0 incorpora la segunda visita al cliente.** Lo más importante para el
> backend: los permisos vuelven a diferenciarse por rol (§4.1, §9), los precios
> se cargan sin IVA (§5.5), el SKU lo genera la base (§5.5), hay unidades por
> caja (§5.5, §7.2), salidas automáticas por lote que vence primero (§8.7),
> consumo interno (§4.3), alertas configurables por categoría (§4.4, §5.9) y
> vencimiento obligatorio al cargar stock (§8.1).

> Este documento no está aprobado hasta que ambos responsables completen la
> sección [Revisión y aprobación](#14-revisión-y-aprobación). Mientras tanto
> no se aplican migraciones ni se fusiona código que dependa de él.

### Responsables

| Área | Responsable | Es dueño de |
|---|---|---|
| Frontend | `efacelli` | `src/`, UI, consumo de vistas y RPC, tipos generados |
| Backend | `ChinoNader18` | `supabase/` (migraciones, RLS, vistas, RPC, seeds, tests de DB) |
| Aprobación de PR | `efacelli` | Revisa y fusiona todos los Pull Request |

- El backend implementa este contrato **tal cual**. Si encuentra un problema, no
  lo resuelve por su cuenta: abre un PR que modifica este documento (y sube la
  versión) antes de cambiar el esquema.
- El frontend no inventa columnas ni tipos: usa los tipos generados desde el
  esquema del backend.
- Para quien usa Claude Code en el backend: leer este documento completo antes
  de escribir cualquier migración y reportar en el PR si concuerda o qué
  diferencias encuentra.

---

## 1. Objetivo

Definir una única estructura de datos compartida por la base (Supabase/PostgreSQL)
y el frontend (React + TypeScript): nombres de tablas y columnas, tipos,
nulabilidad, restricciones, relaciones, funciones RPC y códigos de error.

**Regla de oro:** el esquema de PostgreSQL es la fuente; los tipos TypeScript se
**generan** desde él (`supabase gen types typescript`) y nunca se escriben a mano.
Este documento describe ese esquema y debe coincidir con las migraciones. Si
difieren, es un bug: se corrige el documento o se crea una migración nueva, nunca
se edita una migración aplicada.

---

## 2. Convenciones

### 2.1 Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Idioma de identificadores | Inglés (tablas, columnas, enums, funciones) | `product_batches` |
| Idioma de UI y mensajes | Español | "Stock insuficiente" |
| Tablas | `snake_case`, plural | `stock_movements` |
| Columnas | `snake_case`, singular | `sale_price` |
| Clave primaria | `id` | `products.id` |
| Clave foránea | `<entidad_singular>_id` | `product_id`, `batch_id` |
| Booleanos | prefijo `is_` / `has_` | `is_active` |
| Fechas sin hora (`date`) | sufijo `_on` | `expires_on`, `received_on` |
| Instantes (`timestamptz`) | sufijo `_at` | `created_at`, `occurred_at` |
| Usuario que actúa | sufijo `_by` → `profiles.id` | `created_by` |
| Cantidades | prefijo/sufijo `quantity` | `quantity_available` |
| Importes | sufijo `_price` / `_cost` | `cost_price`, `sale_price` |
| Enums (tipo) | `snake_case` singular | `movement_type` |
| Valores de enum | `snake_case` en inglés | `adjustment_in` |
| Vistas | prefijo `v_` | `v_product_stock` |
| Funciones RPC | verbo + objeto | `receive_stock` |
| Parámetros RPC | prefijo `p_` | `p_product_id` |
| Índices | `<tabla>_<columnas>_idx` / `_key` si son únicos | `products_sku_key` |

### 2.2 Frontend usa los mismos nombres

- El frontend usa **exactamente** los nombres `snake_case` de la base. No hay capa
  de traducción a `camelCase` (cada traducción es un lugar más donde equivocarse).
- Tipos generados en `src/types/database.ts` (archivo generado; prohibido editar).
- Alias de dominio en `src/types/domain.ts`, por ejemplo
  `type Product = Tables<'products'>`, `type MovementType = Enums<'movement_type'>`.
- Serialización en JSON:

| PostgreSQL | TypeScript | Formato |
|---|---|---|
| `uuid` | `string` | UUID v4 |
| `text` | `string` | — |
| `numeric` | `number` | Ver 2.3 |
| `integer` | `number` | — |
| `boolean` | `boolean` | — |
| `date` | `string` | `YYYY-MM-DD` (sin zona horaria) |
| `timestamptz` | `string` | ISO 8601 con zona (`2026-11-14T13:05:00+00:00`) |
| enum | unión de literales | `'entry' \| 'exit' \| ...` |

### 2.3 Números

- **Nunca** `float`/`real`/`double precision` para dinero ni cantidades.
- Dinero: `numeric(12,2)` (hasta 9.999.999.999,99).
- Cantidades de stock: `numeric(12,3)` para admitir productos por peso/volumen
  (ver [P-04](#13-preguntas-abiertas)). Si se decide vender solo por unidad, se
  restringe con `CHECK` sin cambiar el tipo.
- Totales y agregaciones se calculan en PostgreSQL, no sumando en JavaScript.

### 2.4 Fechas y zona horaria

- Instantes en `timestamptz` (se guardan en UTC).
- Vencimientos e ingresos de lote en `date`.
- **"Hoy" se calcula en `America/Argentina/Buenos_Aires`**:
  `(now() at time zone 'America/Argentina/Buenos_Aires')::date`. Usar
  `current_date` en UTC haría que entre las 21:00 y las 24:00 un lote figure
  vencido un día antes.

### 2.5 Columnas comunes

Toda tabla editable (no la de movimientos) tiene:

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` |
| `created_at` | `timestamptz` | no | `now()` |
| `created_by` | `uuid` → `profiles.id` | sí* | `auth.uid()` (trigger en INSERT) |
| `updated_at` | `timestamptz` | no | `now()` (trigger en UPDATE) |
| `updated_by` | `uuid` → `profiles.id` | sí* | `auth.uid()` (trigger en UPDATE) |

\* Nulable solo para datos de semilla/migración; las escrituras de la app siempre
lo completan.

Desde v0.3.1: estas columnas **las fija la base, no el cliente**. Un trigger
`BEFORE INSERT OR UPDATE` escribe `created_at`/`created_by` en el alta y
`updated_at`/`updated_by` en cada edición, y conserva los valores de creación.
Además, `authenticated` solo recibe permiso de `INSERT`/`UPDATE` sobre las
columnas de negocio (permisos por columna), así que un valor enviado por el
cliente para `id`, `created_*` o `updated_*` se rechaza con `42501`. Sin esto,
cualquiera podría registrar un cambio a nombre de otro usuario.

### 2.6 Borrado

- No hay borrado físico desde la app. Se desactiva con `is_active = false`.
- Claves foráneas con `ON DELETE RESTRICT`: un producto con lotes o movimientos no
  puede borrarse.

---

## 3. Fuente única de verdad del stock

**Decisión propuesta:**

1. **`stock_movements` es el registro contable (ledger) y la verdad histórica.**
   Es append-only: no se actualiza ni se borra.
2. **`product_batches.quantity_available` es el único saldo materializado.** Lo
   modifican solo las funciones RPC, en la misma transacción que insertan el
   movimiento. Existe para poder bloquear la fila (`SELECT ... FOR UPDATE`) y
   aplicar `CHECK (quantity_available >= 0)`.
3. **El stock del producto no se guarda**: es `SUM(quantity_available)` de sus
   lotes, expuesto en la vista `v_product_stock`. No existe `products.stock`.
4. **Todo stock pertenece a un lote.** Así no hay dos caminos (con lote / sin
   lote) ni dos saldos. Ver [P-01](#13-preguntas-abiertas). Desde v0.4.0 todos
   los productos se controlan por vencimiento (también limpieza y bazar, que
   vencen en uno o dos años), así que todo lote nuevo lleva fecha (§8.1).
5. **Las cajas no son un segundo stock (v0.4.0).** El stock incluye todas las
   unidades, estén sueltas o dentro de cajas cerradas. `boxes_quantity` es un
   conteo manual de cuántas cajas cerradas hay en depósito; la vista lo traduce a
   unidades para mostrar el desglose (§7.2).

**Invariante verificable** (se testea y puede correrse como chequeo de
conciliación):

```sql
-- Para cada lote, el saldo materializado coincide con el ledger
quantity_available = SUM(signed_quantity) de sus movimientos
```

---

## 4. Enums

### 4.1 `app_role`

| Valor | Persona | Descripción |
|---|---|---|
| `admin` | Dueño | Todo lo del encargado, y además gestiona usuarios (rol y activo) y lee `audit_log` |
| `manager` | Encargado | Catálogos, alta y edición de productos (precios, stock mínimo, unidades por caja), todos los movimientos y reversiones, dashboard y configuración de alertas |
| `staff` | Empleado | Consulta todo (incluidos costos y márgenes), registra **ingresos de mercadería** y **consumo interno**, y actualiza el **conteo de cajas** |

Desde v0.4.0 (segunda visita, [P-10](#13-preguntas-abiertas)): **cargar
productos, cambiar precios, hacer ajustes, registrar mermas y anular
movimientos lo hace solo el encargado** (y el dueño). Esto reemplaza la regla
de v0.3.1 "todos hacen todo". Matriz completa en §9.

### 4.2 `sale_unit`

| Valor | Descripción | Cantidades |
|---|---|---|
| `unit` | Unidad | enteras |
| `kg` | Kilogramo | hasta 3 decimales |
| `l` | Litro | hasta 3 decimales |
| `pack` | Pack | enteras |
| `box` | Caja | enteras |
| `other` | Otra | enteras |

Desde v0.3.0 incluye `pack`, `box` y `other` ([P-04](#13-preguntas-abiertas)).
`box` como unidad de venta es distinto de `products.boxes_quantity` (conteo
manual de cajas en depósito).

### 4.3 `movement_type`

Cada tipo tiene una **dirección fija**, así `quantity` siempre es positiva y el
signo se deriva del tipo.

| Valor | Dirección | Uso | `reason` obligatorio |
|---|---|---|---|
| `entry` | + | Ingreso de mercadería (crea o repone lote) | no |
| `exit` | − | Salida genérica (en el futuro, ventas) | no |
| `adjustment_in` | + | Ajuste positivo por recuento | sí |
| `adjustment_out` | − | Ajuste negativo por recuento | sí |
| `shrinkage` | − | Merma (incluye vencidos descartados) | sí |
| `damage` | − | Daño/rotura | sí |
| `customer_return` | + | Devolución de cliente | sí |
| `supplier_return` | − | Devolución a proveedor | sí |
| `internal_use` | − | Consumo interno, regalo o degustación (v0.4.0) | sí |

`signed_quantity` (§5.7) no cambia: `internal_use` es salida, como todo tipo que
no esté en la lista de entradas.

> **Inconsistencia resuelta:** el requisito decía "ajustes" y "devoluciones" sin
> dirección. Un ajuste puede sumar o restar y una devolución puede ser de cliente
> (suma) o a proveedor (resta). Se separan en dos tipos cada uno para que la
> dirección no dependa del signo de la cantidad. Ver [P-03](#13-preguntas-abiertas).

### 4.4 `expiry_status` (solo en vistas, no se guarda)

Desde v0.4.0 los días de alerta **son configurables por categoría** (§5.9), así
que los valores dejan de llevar el número de días en el nombre. `urgent_days`,
`soon_days` y `notice_days` son los de la categoría del producto (o los
generales si la categoría no tiene propios; por defecto 7, 15 y 30).

Se calcula en orden de precedencia; el primer caso que se cumple gana:

| Orden | Valor | Condición | Antes de v0.4.0 |
|---|---|---|---|
| 1 | `depleted` | `quantity_available = 0` | igual |
| 2 | `no_expiry` | `expires_on IS NULL` | igual |
| 3 | `expired` | `expires_on < hoy` | igual |
| 4 | `expires_urgent` | `expires_on <= hoy + urgent_days` | `expires_7` |
| 5 | `expires_soon` | `expires_on <= hoy + soon_days` | `expires_15` |
| 6 | `expires_upcoming` | `expires_on <= hoy + notice_days` | `expires_30` |
| 7 | `ok` | resto | igual |

- Un lote agotado nunca alerta, aunque esté vencido (requisito).
- Lo que vence **hoy** cuenta como `expires_urgent`, no como `expired`
  ([P-08](#13-preguntas-abiertas)).
- Las alertas se calculan, no se guardan como filas, así que no pueden
  duplicarse.
- La UI muestra texto o ícono además del color (accesibilidad), y el contador
  de días ("vence en 5 días").
- El renombre no rompe datos: el enum todavía no existe en ninguna base. El
  frontend actualiza sus valores en un PR propio.

**Niveles de alerta en la UI** (presentación; no es un dato de la base):

| `expiry_status` | Nivel en la UI | Texto |
|---|---|---|
| `expires_upcoming`, `expires_soon` | `warning` | Próximo a vencer |
| `expires_urgent` | `urgent` | Vencimiento urgente |
| `expired` | `expired` | Vencido |
| `ok`, `no_expiry`, `depleted` | sin alerta | — |

---

## 5. Tablas

### 5.1 `profiles`

Una fila por usuario de Supabase Auth.

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | — | PK, FK → `auth.users.id` `ON DELETE RESTRICT` |
| `full_name` | `text` | no | — | `CHECK (length(trim(full_name)) between 1 and 120)` |
| `role` | `app_role` | no | `'staff'` | Solo `admin` puede cambiarlo (RLS + trigger) |
| `is_active` | `boolean` | no | `true` | Un usuario inactivo no puede operar |
| `created_at` / `updated_at` | `timestamptz` | no | `now()` | — |

- La fila se crea con un trigger sobre `auth.users`; el usuario **no** puede
  insertar su propio perfil ni elegir su rol.
- `full_name` inicial (v0.3.1): `raw_user_meta_data->>'full_name'` si no está
  vacío; si no, la parte del email anterior a la `@`; recortado a 120
  caracteres. El **rol nunca se lee de los metadatos** del usuario (el usuario
  puede modificarlos): siempre nace como `staff`.
- Primer `admin` (v0.3.1): se promueve una única vez por SQL con un rol
  privilegiado (editor SQL del proyecto o semilla local), procedimiento
  documentado en `supabase/README.md`. Desde la app, solo un `admin` cambia
  `role` e `is_active`, y no puede quitarse a sí mismo el rol ni desactivarse
  (evita quedarse sin administradores).
- En la Etapa 1 solo un `admin` edita `full_name`.
- Un usuario con `is_active = false` puede iniciar sesión en Supabase Auth, pero
  la base solo le deja leer **su propio perfil** (para que la UI le explique por
  qué no puede operar).
- Se usa `ON DELETE RESTRICT` porque los movimientos referencian al usuario: no
  se pierde la trazabilidad. Para dar de baja a alguien se usa `is_active = false`.

### 5.2 `categories`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | `CHECK (length(trim(name)) between 1 and 80)`; único sin distinguir mayúsculas: `unique index categories_name_key on lower(trim(name))` |
| `is_active` | `boolean` | no | `true` | — |
| columnas comunes | | | | §2.5 |

Lista plana, sin subcategorías en la Etapa 1 ([P-12](#13-preguntas-abiertas)).

### 5.3 `brands`

Igual que `categories` (`id`, `name` único sin distinguir mayúsculas con el
índice `brands_name_key`, `is_active`, columnas comunes).

### 5.4 `suppliers`

Referencia mínima; el módulo completo de proveedores y compras es de una etapa
futura.

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | 1–120 caracteres; único sin distinguir mayúsculas: `unique index suppliers_name_key on lower(trim(name))` |
| `tax_id` | `text` | sí | — | CUIT de 11 dígitos sin guiones: `CHECK (tax_id ~ '^[0-9]{11}$')`; único si no es nulo: `unique index suppliers_tax_id_key` |
| `phone` | `text` | sí | — | Hasta 40 caracteres |
| `email` | `text` | sí | — | Hasta 254 caracteres; formato básico `algo@algo.algo` sin espacios |
| `notes` | `text` | sí | — | Hasta 1000 caracteres |
| `is_active` | `boolean` | no | `true` | — |
| columnas comunes | | | | §2.5 |

### 5.5 `products`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `sku` | `text` | no | generado | **Lo genera la base** (v0.4.0): `lpad(nextval('products_sku_seq')::text, 6, '0')` → `000001`, `000002`… Único: `unique index products_sku_key on upper(sku)`; `CHECK (sku = trim(sku) and length(sku) between 1 and 40)`. No se edita desde la app ([P-05](#13-preguntas-abiertas)) |
| `barcode` | `text` | sí | — | `CHECK (barcode ~ '^[0-9]{8,14}$')`; único parcial `products_barcode_key` `WHERE barcode IS NOT NULL`. Sin lector en la Etapa 1 |
| `name` | `text` | no | — | 1–150 caracteres |
| `description` | `text` | sí | — | — |
| `category_id` | `uuid` | no | — | FK → `categories.id` ([P-06](#13-preguntas-abiertas)) |
| `brand_id` | `uuid` | no | — | FK → `brands.id` (obligatoria desde v0.3.0, [P-06](#13-preguntas-abiertas)) |
| `supplier_id` | `uuid` | sí | — | FK → `suppliers.id`; proveedor habitual |
| `sale_unit` | `sale_unit` | no | `'unit'` | — |
| `cost_price` | `numeric(12,2)` | no | — | `CHECK (cost_price >= 0)`. Costo **sin IVA** (v0.4.0) |
| `sale_price` | `numeric(12,2)` | no | — | `CHECK (sale_price >= 0)`. Precio de venta **sin IVA**, el que se carga (v0.4.0) |
| `vat_rate` | `numeric(4,2)` | no | `21.00` | `CHECK (vat_rate in (10.50, 21.00))` ([P-02](#13-preguntas-abiertas)) |
| `sale_price_with_vat` | `numeric(12,2)` | no | generada | Precio final de góndola (v0.4.0): `GENERATED ALWAYS AS (round(sale_price * (1 + vat_rate / 100), 2)) STORED`. No se escribe |
| `boxes_quantity` | `integer` | no | `0` | `CHECK (>= 0)`. Conteo manual de **cajas cerradas en depósito**; lo actualiza cualquier usuario activo |
| `units_per_box` | `integer` | no | `12` | `CHECK (units_per_box > 0)`. Unidades por caja (v0.4.0); solo encargado o dueño |
| `min_stock` | `numeric(12,3)` | no | `0` | `CHECK (>= 0)` |
| `is_active` | `boolean` | no | `true` | — |
| `image_path` | `text` | sí | — | Ruta en el bucket privado `product-images`, **no** una URL pública |
| `creation_key` | `uuid` | sí | — | `UNIQUE`. Clave de idempotencia del alta; la completa solo `create_product` (§8.4) |
| columnas comunes | | | | §2.5 |

- **No hay** columna de stock (§3).
- **Precios (v0.4.0, P-02):** `sale_price` y `cost_price` se guardan **sin
  IVA**. El precio de góndola es `sale_price_with_vat`, calculado por la base;
  el frontend no lo calcula. Margen = `sale_price − cost_price`, ambos sin IVA.
- **Cajas (v0.4.0):** las unidades que están dentro de las cajas **forman parte
  del stock** (§3). `boxes_quantity` dice cuántas de esas unidades están en cajas
  cerradas; no suma stock por sí sola. Ver §7.2.
- **SKU (v0.4.0):** generado por la base con la secuencia `products_sku_seq`.
  El cliente no tiene código interno propio; el SKU de 6 dígitos sirve también
  para los productos sin código de barras y, más adelante, como código en la
  balanza.
- Los nombres de los índices únicos (`products_sku_key`, `products_barcode_key`,
  `categories_name_key`, `brands_name_key`, `suppliers_name_key`,
  `suppliers_tax_id_key`) son parte del contrato: el frontend traduce el error
  `23505` por ese nombre.
- `sale_unit` no puede cambiarse si el producto ya tiene movimientos (v0.3.1):
  pasar de `kg` a `unit` con stock fraccionario rompería la regla de cantidades
  enteras. La base lo rechaza con `23514`.
- `image_path`, si se informa, no puede ser una URL (`CHECK` que rechaza
  `http://` y `https://`). La convención de ruta dentro del bucket se define
  cuando el frontend implemente la carga de imágenes.
- No hay `CHECK (sale_price >= cost_price)`: vender por debajo del costo puede ser
  legítimo. La UI solo lo advierte.
- `vat_rate` se guarda como número y no como enum para poder calcular con él;
  agregar otra alícuota (27%, 0%) requiere una migración que cambie el `CHECK`.

### 5.6 `product_batches`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK; además `UNIQUE (id, product_id)` para la FK compuesta |
| `product_id` | `uuid` | no | — | FK → `products.id` |
| `batch_number` | `text` | sí | — | Número de lote del fabricante, opcional ([P-07](#13-preguntas-abiertas)) |
| `received_on` | `date` | no | hoy (AR) | Fecha de ingreso |
| `expires_on` | `date` | sí | — | Obligatorio al crear lotes desde la app (v0.4.0, §8.1). `NULL` solo en datos de semilla/migración (= sin vencimiento) |
| `quantity_initial` | `numeric(12,3)` | no | — | `CHECK (> 0)`; se fija al crear el lote y no cambia |
| `quantity_available` | `numeric(12,3)` | no | — | `CHECK (>= 0)`. **Solo lo modifican las RPC** |
| `notes` | `text` | sí | — | Observaciones |
| columnas comunes | | | | §2.5 |

- Los lotes se crean **solo** mediante `receive_stock` o `create_product`: el
  `INSERT` directo está revocado. El `UPDATE` directo se limita, con permisos
  por columna, a `batch_number`, `expires_on` y `notes`.
- No se agrega `CHECK (quantity_available <= quantity_initial)`: un ajuste
  positivo o una devolución puede superar la cantidad inicial.
- `expires_on < received_on`: la UI lo advierte; si la base debe rechazarlo está
  pendiente ([P-09](#13-preguntas-abiertas)).
- El costo por lote se deja para la etapa de compras (se agregará una columna
  nulable, compatible hacia atrás).

### 5.7 `stock_movements` (append-only)

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `idempotency_key` | `uuid` | no | — | `UNIQUE`. Lo genera el cliente una vez por operación y lo reutiliza en los reintentos. En `register_product_movement` lo genera la base para cada movimiento |
| `operation_key` | `uuid` | sí | — | v0.4.0. Clave de la operación de `register_product_movement` (§8.7): la comparten todos los movimientos que generó una misma salida. Índice `stock_movements_operation_key_idx` |
| `product_id` | `uuid` | no | — | — |
| `batch_id` | `uuid` | no | — | FK compuesta `(batch_id, product_id)` → `product_batches(id, product_id)`: el lote pertenece al producto, garantizado por la base |
| `movement_type` | `movement_type` | no | — | — |
| `quantity` | `numeric(12,3)` | no | — | `CHECK (quantity > 0)` |
| `signed_quantity` | `numeric(12,3)` | no | generada | `GENERATED ALWAYS AS (CASE WHEN movement_type IN ('entry','adjustment_in','customer_return') THEN quantity ELSE -quantity END) STORED` |
| `batch_quantity_after` | `numeric(12,3)` | no | — | Saldo del lote después del movimiento, para auditoría y conciliación |
| `reason` | `text` | sí | — | Obligatorio (no vacío) para todo tipo salvo `entry` y `exit`: `CHECK` |
| `notes` | `text` | sí | — | — |
| `reverses_movement_id` | `uuid` | sí | — | FK → `stock_movements.id`; `UNIQUE` (un movimiento se revierte una sola vez) |
| `occurred_at` | `timestamptz` | no | `now()` | Cuándo ocurrió físicamente ([P-11](#13-preguntas-abiertas)) |
| `created_at` | `timestamptz` | no | `now()` | Cuándo se registró; no lo puede fijar el cliente |
| `created_by` | `uuid` | no | `auth.uid()` | FK → `profiles.id` |

- **Sin `updated_at`/`updated_by`**: un trigger rechaza `UPDATE` y `DELETE`, y
  no se otorgan esos permisos a `authenticated`.
- **Corrección:** se crea un movimiento compensatorio de dirección opuesta con
  `reverses_movement_id` apuntando al original (por ejemplo, `entry` erróneo →
  `adjustment_out` con `reverses_movement_id`).
- `INSERT` directo revocado: solo se escribe por RPC.
- Un movimiento de reversión (con `reverses_movement_id`) **no puede revertirse**
  a su vez (v0.3.1): si la reversión fue un error, se registra un movimiento
  nuevo.
- Índices: `(product_id, occurred_at desc)`, `(batch_id)`, `(created_by)`.
- Preparación para ventas: más adelante se agregarán columnas nulables de origen
  (por ejemplo `source_type`/`source_id`) con un índice único, para que una venta
  descuente stock una sola vez. No se crean ahora.

### 5.8 `audit_log` (propuesta)

Registra cambios en tablas editables (`products`, `product_batches`, `categories`,
`brands`, `suppliers`, `profiles`) mediante triggers. Sin esto, un cambio de precio
o de cajas no deja rastro.

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `bigint` identity | no | PK |
| `table_name` | `text` | no | — |
| `record_id` | `uuid` | no | — |
| `action` | `text` | no | `CHECK (action in ('insert','update'))` |
| `old_data` | `jsonb` | sí | — |
| `new_data` | `jsonb` | sí | — |
| `changed_by` | `uuid` | sí | `auth.uid()` |
| `changed_at` | `timestamptz` | no | `now()` |

Solo se lee (rol `admin`), nunca se escribe desde el cliente. No guarda secretos
ni tokens.

En `product_batches` solo se auditan los cambios de `batch_number`, `expires_on`
y `notes` (v0.3.1): los cambios de saldo ya quedan en `stock_movements` y
duplicarlos solo agregaría ruido.

El cliente pidió que quede registrado **qué perfil hizo qué cosa** (respuesta
25): `audit_log.changed_by` y `stock_movements.created_by` lo cubren.

### 5.9 `expiry_alert_settings` (v0.4.0)

Días de alerta de vencimiento. Una fila general (`category_id IS NULL`) y, si
hace falta, una por categoría (respuesta 6: "distintas por categoría").

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `category_id` | `uuid` | sí | — | FK → `categories.id`. `NULL` = configuración general. Único: `unique index expiry_alert_settings_category_key on (coalesce(category_id, '00000000-0000-0000-0000-000000000000'))` (una sola fila general y una por categoría) |
| `urgent_days` | `integer` | no | `7` | `CHECK (urgent_days >= 0)` |
| `soon_days` | `integer` | no | `15` | `CHECK (soon_days >= urgent_days)` |
| `notice_days` | `integer` | no | `30` | `CHECK (notice_days >= soon_days and notice_days <= 365)` |
| columnas comunes | | | | §2.5 |

- La migración crea la fila general con 7 / 15 / 30.
- La fila general no se puede borrar; las de categoría se borran para volver a
  la general (única excepción a "no hay borrado físico", porque no es historial).
- La lee cualquier usuario activo; la crean, editan y borran el encargado y el
  dueño (§9).
- `expiry_status` (§4.4) usa los días de la categoría del producto si existe su
  fila; si no, los generales.

---

## 6. Diagrama de relaciones

```
auth.users 1─1 profiles
profiles   1─N (created_by / updated_by en todas las tablas)

categories 1─N products
categories 1─0..1 expiry_alert_settings   (más una fila general sin categoría)
brands     1─N products
suppliers  1─N products        (opcional)

products        1─N product_batches
product_batches 1─N stock_movements   (FK compuesta con product_id)
stock_movements 1─0..1 stock_movements (reverses_movement_id)
```

---

## 7. Vistas (lectura)

Todas con `WITH (security_invoker = true)` para que respeten la RLS de quien
consulta. Sin esto, una vista ignora la RLS.

### 7.1 `v_batch_status`

Columnas de `product_batches` más `days_to_expiry integer` (nulo si no vence) y
`expiry_status expiry_status` (§4.4).

### 7.2 `v_product_stock`

| Columna | Tipo | Cálculo |
|---|---|---|
| `product_id` | `uuid` | — |
| `stock_quantity` | `numeric(12,3)` | `COALESCE(SUM(quantity_available), 0)` |
| `next_expires_on` | `date` | `MIN(expires_on)` de lotes con `quantity_available > 0` |
| `next_expiry_status` | `expiry_status` (nulable) | Estado del lote que vence primero con stock. Si hay stock pero ningún lote con vencimiento: `no_expiry`. Si no hay ningún lote con stock: `NULL` (v0.3.1) |
| `active_batches_count` | `integer` | Lotes con `quantity_available > 0` |
| `is_low_stock` | `boolean` | `stock_quantity <= min_stock` ([P-08](#13-preguntas-abiertas)) |
| `units_in_boxes` | `numeric(12,3)` | `boxes_quantity * units_per_box` (v0.4.0) |
| `loose_units` | `numeric(12,3)` | `stock_quantity - units_in_boxes`: unidades sueltas (v0.4.0) |
| `has_box_mismatch` | `boolean` | `loose_units < 0`: las cajas contadas superan el stock; hay que revisar el conteo (v0.4.0) |

Ejemplo (respuesta 8): 84 unidades de stock, 5 cajas de 12 → `units_in_boxes = 60`,
`loose_units = 24`. La UI muestra "84 u. (24 sueltas + 5 cajas de 12)". Si
`has_box_mismatch`, la UI lo marca; la base no corrige nada sola.

La vista incluye **todos** los productos: uno sin lotes tiene `stock_quantity = 0`
y `active_batches_count = 0`. Consecuencia de P-08: con `min_stock = 0`, un
producto sin stock figura con `is_low_stock = true`.

### 7.3 `v_product_list`

Lo que lee la pantalla de listado: columnas de `products` (incluidas
`sale_price_with_vat` y `units_per_box`) más `category_name`, `brand_name`,
`supplier_name` y las de `v_product_stock`. La búsqueda, los filtros, el orden y
la paginación se hacen sobre esta vista, sin repetir las reglas en React.

### 7.4 `v_inventory_summary` (v0.4.0, dashboard)

Una fila con las métricas del dashboard (respuestas 5 y 31). Devuelve filas
**solo a encargado y dueño**: el filtro está dentro de la vista
(`WHERE private.is_manager_or_admin()`), no en React.

| Columna | Tipo | Cálculo |
|---|---|---|
| `active_products` | `integer` | Productos activos |
| `low_stock_products` | `integer` | Activos con `is_low_stock` |
| `expiring_products` | `integer` | Activos con `next_expiry_status` en `expires_urgent`, `expires_soon` o `expires_upcoming` |
| `expired_batches` | `integer` | Lotes con stock y `expired` |
| `stock_value_cost` | `numeric(14,2)` | `SUM(stock_quantity * cost_price)` de activos (sin IVA) |
| `stock_value_sale` | `numeric(14,2)` | `SUM(stock_quantity * sale_price_with_vat)` de activos |
| `shrinkage_quantity_month` | `numeric(14,3)` | Suma de `shrinkage`, `damage` e `internal_use` del mes actual (Argentina) |
| `box_mismatch_products` | `integer` | Productos con `has_box_mismatch` |

Los reportes que el cliente pidió como imprescindibles (respuesta 31) son
**stock bajo** y **por vencer**: salen de `v_product_list` con los filtros que
ya existen.

---

## 8. Funciones RPC (escritura de stock)

Todas: `SECURITY DEFINER`, `SET search_path = ''`, nombres calificados, validan
rol y `is_active` del usuario, una transacción por llamada, `EXECUTE` otorgado
solo a `authenticated` (revocado explícitamente a `PUBLIC` y `anon`).

Los parámetros de fecha con valor por defecto se declaran `default null` y el
servidor los resuelve (v0.3.1): `null` en `p_received_on` significa hoy
(Argentina) y `null` en `p_occurred_at` significa `now()`. Enviar `null`
explícito es equivalente a omitir el parámetro.

### 8.1 `receive_stock` — ingreso con lote nuevo

```
receive_stock(
  p_idempotency_key uuid,
  p_product_id      uuid,
  p_quantity        numeric,
  p_received_on     date    default null,   -- null = hoy (AR)
  p_expires_on      date    default null,   -- obligatorio desde v0.4.0
  p_batch_number    text    default null,
  p_notes           text    default null
) returns stock_movements
```

Crea el lote (`quantity_initial = quantity_available = p_quantity`) y el
movimiento `entry` en una sola transacción. `p_received_on` no puede ser futura
(`INVALID_DATE`).

- **Vencimiento obligatorio (v0.4.0, respuesta 11):** `p_expires_on` nulo →
  `EXPIRY_REQUIRED`. Todos los productos vencen, incluidos limpieza y bazar
  (aproximadamente cada 2 años).
- **Ingreso por cajas:** la RPC siempre recibe **unidades de venta**. Si el
  usuario carga "5 cajas", la UI lo convierte con `units_per_box` y muestra la
  cuenta antes de confirmar.
- **Comprobante:** el tipo y número de factura o remito, si se quiere guardar,
  va en `p_notes`. El registro formal de compras es de una etapa futura.
- Pueden usarla todos los usuarios activos (el empleado registra ingresos, §9).

### 8.2 `register_stock_movement` — movimiento sobre un lote elegido

Desde v0.4.0 las salidas habituales usan `register_product_movement` (§8.7),
que elige los lotes solo. Esta RPC queda para **correcciones puntuales sobre un
lote concreto** (por ejemplo, un ajuste de recuento de un lote) y la usan solo
encargado y dueño.

```
register_stock_movement(
  p_idempotency_key uuid,
  p_batch_id        uuid,
  p_movement_type   movement_type,
  p_quantity        numeric,
  p_reason          text        default null,
  p_notes           text        default null,
  p_occurred_at     timestamptz default null   -- null = now()
) returns stock_movements
```

`product_id` se toma del lote, no del cliente. Bloquea el lote con
`FOR UPDATE`, valida que el saldo no quede negativo, actualiza
`quantity_available` e inserta el movimiento.

`p_occurred_at` (P-11): no puede ser futura (con 5 minutos de tolerancia por
diferencias de reloj) ni anterior a 7 días; fuera de ese rango → `INVALID_DATE`.

### 8.3 `reverse_stock_movement`

```
reverse_stock_movement(
  p_idempotency_key uuid,
  p_movement_id     uuid,
  p_reason          text
) returns stock_movements
```

Crea el movimiento compensatorio (`adjustment_in` o `adjustment_out`) con
`reverses_movement_id`. Falla si ya fue revertido o si dejaría el lote en
negativo.

Reglas (v0.3.1):

- `p_reason` es obligatorio (`REASON_REQUIRED`).
- La reversión **no** aplica `BATCH_EXPIRED` ni `PRODUCT_INACTIVE`: tiene que
  poder corregirse un ingreso mal cargado aunque el lote esté vencido o el
  producto inactivo. Solo valida `ALREADY_REVERSED` e `INSUFFICIENT_STOCK`.
- Revertir un movimiento que ya es una reversión → `INVALID_MOVEMENT_TYPE`.
- `occurred_at` de la reversión es `now()`.

### 8.4 `create_product` — alta de producto con stock inicial opcional

```
create_product(
  p_idempotency_key  uuid,
  p_name             text,
  p_category_id      uuid,
  p_brand_id         uuid,
  p_sale_unit        sale_unit,
  p_cost_price       numeric,
  p_sale_price       numeric,
  p_vat_rate         numeric,
  p_barcode          text    default null,
  p_description      text    default null,
  p_supplier_id      uuid    default null,
  p_boxes_quantity   integer default 0,
  p_units_per_box    integer default 12,
  p_min_stock        numeric default 0,
  p_is_active        boolean default true,
  p_image_path       text    default null,
  p_initial_quantity numeric default null,
  p_received_on      date    default null,   -- null = hoy (AR)
  p_expires_on       date    default null,
  p_batch_number     text    default null
) returns products
```

- Crea el producto y, si `p_initial_quantity > 0`, su primer lote y el
  movimiento `entry`, todo en una transacción: o se crea todo o nada.
- Es la única forma de dar de alta un producto: el `INSERT` directo sobre
  `products` está revocado. La edición posterior sí es `UPDATE` directo (con
  RLS), y nunca toca stock.
- **Sin `p_sku` (v0.4.0):** la base asigna el SKU con `products_sku_seq` y lo
  devuelve en la fila del producto. La UI lo muestra después de guardar.
- Idempotencia (v0.4.0): la clave se guarda **siempre** en
  `products.creation_key uuid UNIQUE NULL` (nulable para filas viejas o de
  semilla; el cliente nunca la escribe directamente) y, si hay stock inicial,
  también como `idempotency_key` del movimiento `entry`. Un reintento con la
  misma clave y el mismo nombre (sin distinguir mayúsculas ni espacios de los
  extremos) devuelve el producto ya creado, con su SKU; la misma clave con otro
  nombre da `IDEMPOTENCY_CONFLICT`. Un reintento nunca consume otro número de
  SKU.
- Un código de barras repetido devuelve `23505` sobre `products_barcode_key`.
- `p_received_on` no puede ser futura (`INVALID_DATE`). Con stock inicial,
  `p_expires_on` es obligatorio (`EXPIRY_REQUIRED`).
- Solo encargado y dueño (§9).
- `p_initial_quantity` nula o 0 → el producto se crea sin lotes (stock 0).

### 8.5 Idempotencia

- Si `p_idempotency_key` ya existe **con los mismos datos**, se devuelve el
  movimiento existente sin crear otro (reintento seguro).
- Si existe **con datos distintos**, se lanza `IDEMPOTENCY_CONFLICT`.
- "Mismos datos" (v0.3.1) significa que coinciden estos campos:

  | RPC | Campos comparados |
  |---|---|
  | `receive_stock` | `product_id`, `quantity`, tipo `entry` |
  | `register_stock_movement` | `batch_id`, `movement_type`, `quantity` |
  | `reverse_stock_movement` | `reverses_movement_id` |
  | `create_product` | `name` (sin distinguir mayúsculas; v0.4.0, el SKU ya no lo envía el cliente) |
  | `register_product_movement` | `product_id`, `movement_type`, cantidad total (§8.7) |

  No se comparan `occurred_at`, `received_on`, `reason` ni `notes`: un reintento
  que el servidor resuelve con otra hora no debe dar un conflicto falso.
- Dos reintentos simultáneos con la misma clave se serializan en la base: uno
  crea el movimiento y el otro lo recibe como respuesta.
- El cliente genera la clave con `crypto.randomUUID()` al abrir el formulario y
  la conserva hasta tener una respuesta definitiva. Esto también sirve para la
  futura cola offline.

### 8.6 Códigos de error

Se lanzan con `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODIGO>'`.
El frontend traduce el código a español; no muestra mensajes crudos de la base.

| Código | Cuándo |
|---|---|
| `NOT_AUTHORIZED` | Sin sesión, sin perfil, rol sin permiso o usuario inactivo |
| `PRODUCT_NOT_FOUND` / `BATCH_NOT_FOUND` / `MOVEMENT_NOT_FOUND` | ID inexistente o no visible |
| `PRODUCT_INACTIVE` | Movimiento sobre un producto inactivo ([P-13](#13-preguntas-abiertas)) |
| `INVALID_QUANTITY` | Cantidad ≤ 0, o con decimales en una unidad de cantidades enteras (`unit`, `pack`, `box`, `other`) |
| `SKU_ALREADY_EXISTS` | Reservado: desde v0.4.0 `create_product` ya no recibe SKU, así que no debería ocurrir |
| `INSUFFICIENT_STOCK` | La salida dejaría el lote en negativo, o los lotes utilizables del producto no alcanzan (§8.7) |
| `REASON_REQUIRED` | Falta el motivo en un tipo que lo exige |
| `INVALID_MOVEMENT_TYPE` | `entry` vía `register_stock_movement` (usar `receive_stock`); revertir un movimiento que ya es una reversión |
| `ALREADY_REVERSED` | El movimiento ya tiene compensación |
| `BATCH_EXPIRED` | Salida de un lote vencido con un tipo distinto de `shrinkage`, `damage` o `supplier_return` ([P-15](#13-preguntas-abiertas)) |
| `IDEMPOTENCY_CONFLICT` | Clave reutilizada con otros datos |
| `INVALID_DATE` | `occurred_at` futura o con más de 7 días de atraso; `received_on` futura (v0.3.1) |
| `EXPIRY_REQUIRED` | Ingreso de stock (`receive_stock` o `create_product` con stock inicial) sin fecha de vencimiento (v0.4.0) |

Los errores de restricciones (`23505` unique, `23514` check, `23503` FK) se
mapean en el frontend: por ejemplo, `23505` sobre `products_sku_key` →
"El SKU ya existe".

### 8.7 `register_product_movement` — salida o entrada por producto, lotes por vencimiento (v0.4.0)

Respuesta 9: el sistema elige solo de qué lote sale la mercadería, empezando por
el que vence primero (FEFO).

```
register_product_movement(
  p_idempotency_key uuid,
  p_product_id      uuid,
  p_movement_type   movement_type,
  p_quantity        numeric,
  p_reason          text        default null,
  p_notes           text        default null,
  p_occurred_at     timestamptz default null   -- null = now()
) returns setof stock_movements
```

- **Salidas** (`exit`, `adjustment_out`, `shrinkage`, `damage`,
  `supplier_return`, `internal_use`): recorre los lotes con stock del producto
  en orden `expires_on`, `received_on`, `id`, los bloquea con `FOR UPDATE` y
  descuenta de cada uno lo que tenga hasta completar la cantidad. Si un lote no
  alcanza, sigue con el siguiente: una salida puede generar **varios
  movimientos**, uno por lote, todos en la misma transacción.
- **Lotes vencidos:** para `shrinkage`, `damage` y `supplier_return` se usan
  primero (son los que vencen antes). Para los demás tipos se **saltean**, porque
  lo vencido no se vende ni se consume (P-15).
- Si los lotes que se pueden usar no alcanzan → `INSUFFICIENT_STOCK` y **no se
  registra nada**. Nunca queda stock negativo.
- **Entradas** (`adjustment_in`, `customer_return`): van al lote con stock que
  vence más tarde; si no hay ninguno, al último lote recibido. Si el producto no
  tiene lotes → `BATCH_NOT_FOUND` (hay que registrar un ingreso con
  `receive_stock`). `entry` no se acepta (`INVALID_MOVEMENT_TYPE`).
- **Idempotencia:** `p_idempotency_key` se guarda en la nueva columna
  `stock_movements.operation_key uuid NULL` de todos los movimientos generados;
  cada movimiento lleva su propio `idempotency_key` (generado por la base). Un
  reintento con la misma clave devuelve los mismos movimientos. La
  serialización usa un bloqueo consultivo sobre la clave.
- Mismas validaciones que §8.2: cantidad, motivo, fecha, producto inactivo.
- Permisos (§9): el empleado solo puede usar `internal_use`; el resto de los
  tipos, encargado y dueño.

### 8.8 Transición desde las migraciones ya fusionadas

Antes de esta versión se fusionaron en `main` las migraciones de enums,
`profiles` y catálogos (v0.3.1). La v0.4.0 se implementa con **migraciones
nuevas**, sin reescribir esas:

- `ALTER TYPE public.movement_type ADD VALUE 'internal_use'`.
- `ALTER TYPE public.expiry_status RENAME VALUE 'expires_7' TO 'expires_urgent'`
  (y `expires_15` → `expires_soon`, `expires_30` → `expires_upcoming`).
- Función `private.is_manager_or_admin()` y reemplazo de las políticas de
  `INSERT`/`UPDATE` de `categories`, `brands` y `suppliers` para que solo
  escriban encargado y dueño.

---

## 9. Seguridad (resumen de RLS propuesta)

RLS activada en todas las tablas del esquema `public`. Desde v0.4.0 (segunda
visita, [P-10](#13-preguntas-abiertas)) los permisos se diferencian por rol.
"Encargado" incluye al dueño: todo lo que puede `manager` también lo puede
`admin`.

| Objeto | Empleado (`staff`) | Encargado (`manager`) | Solo dueño (`admin`) | Usuario inactivo |
|---|---|---|---|---|
| `profiles` | lee todos (`id`, `full_name`, `role`, `is_active`) | ídem | edita `full_name`, `role`, `is_active` | lee solo el propio |
| `categories`, `brands`, `suppliers` | lee | lee / crea / edita | — | — |
| `products` | lee (incluidos costos); edita **solo** `boxes_quantity` | lee / crea (vía `create_product`) / edita todo lo editable, incluidos precios, `min_stock` y `units_per_box` | — | — |
| `product_batches` | lee | lee; edita `batch_number`, `expires_on`, `notes` | — | — |
| `stock_movements` | lee; `receive_stock` y `register_product_movement` con `internal_use` | lee; todas las RPC de §8, incluida la reversión | — | — |
| `expiry_alert_settings` | lee | lee / crea / edita / borra filas de categoría | — | — |
| `v_inventory_summary` (dashboard) | sin filas | lee | — | — |
| `audit_log` | — | — | lee | — |

- Para implementarlo: `private.is_manager_or_admin()` (activo y rol `manager` o
  `admin`) junto a los `private.is_active_user()` e `private.is_admin()` que ya
  existen. Las RPC devuelven `NOT_AUTHORIZED` si el rol no alcanza.
- El empleado edita `boxes_quantity` con un permiso por columna
  (`GRANT UPDATE (boxes_quantity)`) y una política de `UPDATE` para usuarios
  activos; el resto de las columnas de `products` requiere encargado.
- Todos los usuarios activos leen los perfiles porque el historial muestra quién
  hizo cada movimiento.
- Acceso de administrador a las cuentas del proyecto (Supabase, GitHub, copias
  de seguridad): **dueño y encargado** (respuesta 36). Es configuración de
  infraestructura, no de la base.
- Nadie hace `DELETE` desde la app, ni `INSERT`/`UPDATE`/`DELETE` directo sobre
  `stock_movements`, ni escribe `product_batches.quantity_*`.
- Usuarios `anon`: sin acceso a ninguna tabla, vista ni función.
- "Activo" se comprueba en la base (`profiles.is_active`) en cada política y en
  cada RPC, no en React.
- Bucket `product-images`: privado; lectura para usuarios activos y escritura para encargado y dueño (quienes editan productos).

---

## 10. Inconsistencias detectadas en los requisitos

| # | Requisito | Problema | Propuesta |
|---|---|---|---|
| I-01 | "Stock actual con una única fuente de verdad" + lotes con cantidad disponible | Si existen `products.stock` y `product_batches.quantity_available`, hay dos verdades que pueden divergir | Ledger + saldo por lote; el stock del producto es una vista (§3) |
| I-02 | "Lote cuando corresponda" | Movimientos con y sin lote obligan a llevar stock a dos niveles | Todo stock en lotes. Desde v0.4.0 todo lote nuevo lleva vencimiento |
| I-03 | "Ajustes" y "devoluciones" | Dirección ambigua | Tipos separados con dirección fija (§4.3) |
| I-04 | "Unidad de venta" | Si hay productos por peso, las cantidades enteras no alcanzan | `numeric(12,3)` y validación de enteros para `unit` |
| I-05 | "Costo y precio de venta" + IVA | No se dice si los precios incluyen IVA | **Resuelto en v0.4.0:** se cargan sin IVA; la base calcula el precio final (§5.5) |
| I-06 | "Cajas manuales e independientes" | Las cajas no siguen a los movimientos y se desactualizan sin aviso | Columna manual auditada en `audit_log`. **v0.4.0:** el cliente quiere stock = sueltas + cajas; se resuelve sin doble conteo (§3, §7.2) y la vista marca cuando el conteo de cajas no cierra |
| I-07 | "Vencido" | `current_date` en UTC adelanta el vencimiento 3 horas | "Hoy" en la zona horaria de Buenos Aires (§2.4) |
| I-08 | "Stock mínimo" / "stock bajo" | No se define si es `<` o `<=`, ni qué pasa con mínimo 0 | `<=` propuesto; pregunta P-08 |
| I-09 | "Fecha" del movimiento | ¿Fecha real o de registro? ¿Se permiten fechas pasadas? | `occurred_at` y `created_at` separados; pregunta P-11 |
| I-10 | "Auditar operaciones relevantes" | Los movimientos se auditan, pero los cambios de precio o cajas no | Tabla `audit_log` (§5.8) |
| I-11 | "Preparar para futuras ventas" | Una salida sin elegir lote necesita una regla de asignación | **Resuelto en v0.4.0:** el sistema elige por vencimiento (§8.7); las ventas futuras usarán la misma regla |
| I-12 | Permisos (v0.3.1 vs. segunda visita) | La primera visita dijo "todos hacen todo"; la segunda, "solo el encargado" | Se adopta la segunda (§4.1, §9) |

---

## 11. Fuera de alcance (no crear todavía)

Compras, recepción formal y costo por lote; márgenes y aumentos; descuentos;
clientes y cuentas corrientes; ventas, caja y tickets; ARCA; offline/PWA;
historial de precios separado del `audit_log`. Todas se agregan después con
migraciones compatibles hacia atrás.

Anotado en la segunda visita para esas etapas (ver
`docs/RELEVAMIENTO_RESPUESTAS.md`): alertas por **WhatsApp** (requiere un
proveedor de mensajería pago), **conteo de stock desde el celular**, **cuenta
corriente** con alertas de deudores configurables y bloqueo por deuda alta,
**descuentos** desde 6 unidades y cada 6, **2 cajas** cobrando a la vez, cinco
medios de pago, y el **código de barras de la balanza** (prefijo `2`, código de
producto de 6 dígitos y peso en gramos), que necesitará un campo de código de
balanza por producto.

---

## 12. Pruebas que este contrato exige

- SKU (v0.4.0): `create_product` asigna `000001`, `000002`… en orden; un
  reintento con la misma clave devuelve el mismo SKU y no consume otro número.
- Cantidad 0 y negativa → `INVALID_QUANTITY`.
- Salida mayor al saldo → `INSUFFICIENT_STOCK` y el saldo no cambia.
- Lote agotado → `depleted` y sin alerta.
- Lote de semilla sin vencimiento → `no_expiry`. Ingreso sin vencimiento desde
  la app → `EXPIRY_REQUIRED`.
- Vencimiento pasado → `expired`; vencimiento hoy → `expires_urgent`.
- Alertas por categoría: con la fila general 7/15/30 y una categoría con 10/20/45,
  un lote de esa categoría que vence en 40 días es `expires_upcoming` y uno de
  otra categoría es `ok`.
- FEFO: con lotes A (vence antes, 4 u.) y B (20 u.), una salida de 10 genera
  4 de A y 6 de B; una salida de 30 → `INSUFFICIENT_STOCK` sin registrar nada;
  `internal_use` saltea un lote vencido y `shrinkage` lo usa primero.
- Reintento de `register_product_movement` con la misma clave → mismos
  movimientos, sin duplicar.
- Precio final: `sale_price` 1000 con IVA 21 → `sale_price_with_vat` 1210.00;
  con 10,5 → 1105.00.
- Cajas: stock 84, 5 cajas de 12 → `loose_units` 24; 8 cajas de 12 →
  `has_box_mismatch`.
- Permisos v0.4.0: el empleado registra un ingreso, un `internal_use` y cambia
  `boxes_quantity`; no puede crear productos, cambiar precios, `units_per_box`
  ni `min_stock`, registrar mermas ni revertir; no ve filas en
  `v_inventory_summary`.
- Lote de otro producto → la FK compuesta lo rechaza.
- `UPDATE`/`DELETE` sobre `stock_movements` → rechazado.
- Mismo `idempotency_key` dos veces → un solo movimiento; con otros datos →
  `IDEMPOTENCY_CONFLICT`.
- Dos salidas concurrentes sobre el mismo lote → nunca saldo negativo.
- Revertir dos veces → `ALREADY_REVERSED`.
- `exit` sobre un lote vencido → `BATCH_EXPIRED`; `shrinkage` sobre el mismo
  lote → permitido.
- `occurred_at` a futuro o con más de 7 días de atraso → `INVALID_DATE`; con 3
  días de atraso → permitido para cualquier rol que pueda registrar ese
  movimiento.
- `received_on` futura → `INVALID_DATE`.
- Revertir una reversión → `INVALID_MOVEMENT_TYPE`; revertir un `entry` de un
  lote vencido o de un producto inactivo → permitido.
- Usuario inactivo: no lee tablas (salvo su perfil) y toda RPC devuelve
  `NOT_AUTHORIZED`.
- `created_by`/`updated_by` enviados por el cliente → rechazados.
- Movimiento `exit` sobre producto inactivo → `PRODUCT_INACTIVE`.
- Cantidad con decimales en producto `unit` → `INVALID_QUANTITY`.
- Conciliación: `quantity_available` = suma del ledger para todos los lotes.
- RLS: cada fila de §9 probada con un usuario permitido y uno denegado; `anon`
  sin acceso; un usuario que no es `admin` no puede cambiar su rol ni el de otro;
  un empleado no puede crear ni editar catálogos.
- Migraciones aplicadas sobre una base con datos ficticios previos: los conteos
  y las relaciones se conservan.

---

## 13. Preguntas abiertas

Desde la versión 0.2.0, las respuestas marcadas como **Adoptada** son la regla
vigente para implementar. Pueden cambiarse más adelante con un PR que modifique
este documento y una migración nueva.

| # | Pregunta | Respuesta | Estado |
|---|---|---|---|
| P-01 | ¿Todo stock se registra en lotes, aunque el producto no venza? | Sí. Desde v0.4.0 todos los productos vencen (limpieza y bazar, cada 2 años aprox.) | Adoptada |
| P-02 | ¿`cost_price` y `sale_price` incluyen IVA? | **No.** Se cargan sin IVA; el precio de góndola lo calcula la base (`sale_price_with_vat`). El negocio es Responsable Inscripto | Adoptada (v0.4.0) |
| P-03 | ¿Las devoluciones son de clientes, a proveedores o ambas? | Ambas, como tipos separados | Adoptada |
| P-04 | ¿Hay productos por peso o volumen? ¿Qué unidades? | `unit`, `kg`, `l`, `pack`, `box`, `other` (v0.3.0, pedido del cliente) | Adoptada |
| P-05 | ¿El SKU tiene formato (largo, caracteres)? ¿Distingue mayúsculas? | v0.4.0: el cliente no tiene código interno; la base genera un número de 6 dígitos (`000001`) | Adoptada |
| P-06 | ¿Categoría y marca son obligatorias? | Ambas obligatorias. El cliente confirmó que no hay productos sin marca | Adoptada |
| P-16 | ¿El alta de producto incluye stock inicial? | Sí, opcional, mediante `create_product` (§8.4), que crea lote y movimiento `entry` | Adoptada |
| P-07 | ¿El número de lote debe ser único por producto? | No (el mismo lote puede llegar en dos entregas) | Adoptada |
| P-08 | ¿Stock bajo es `<=` o `<` al mínimo? ¿Lo que vence hoy está vencido? | `<=`; lo que vence hoy está por vencer | Adoptada |
| P-09 | ¿Se rechaza `expires_on` anterior a `received_on`? | No; solo advertencia en la UI | Adoptada |
| P-10 | ¿Qué roles hay y qué puede hacer cada uno? | v0.4.0 (segunda visita): dueño (`admin`), encargado (`manager`) y empleado (`staff`). Productos, precios, ajustes, mermas, reversiones, catálogos y dashboard: encargado y dueño. El empleado consulta (también costos), registra ingresos y consumo interno, y actualiza el conteo de cajas. Tabla §9 | Adoptada |
| P-11 | ¿Se permite cargar movimientos con fecha pasada? ¿Hasta cuánto? | Sí, hasta 7 días (el cliente carga con hasta una semana de atraso); nunca a futuro | Adoptada |
| P-12 | ¿Hacen falta subcategorías? | No en la Etapa 1 | Adoptada |
| P-13 | ¿Se permiten movimientos sobre productos inactivos? | Solo salidas `shrinkage`/`damage`/`supplier_return` | Adoptada |
| P-14 | En salidas, ¿se elige el lote o se aplica primero el que vence antes (FEFO)? | v0.4.0: **automático**, el que vence primero; si no alcanza, sigue con el siguiente (§8.7) | Adoptada |
| P-15 | ¿Se puede sacar de un lote vencido algo que no sea merma? | No: solo `shrinkage`, `damage` o `supplier_return` (`BATCH_EXPIRED`). Lo vencido se tira; ningún proveedor lo retira | Adoptada |
| P-17 | ¿Cómo se relacionan cajas y stock? | Stock = sueltas + cajas; el stock incluye todo y las cajas son un desglose (§3, §7.2). 12 unidades por caja por defecto; solo encargado o dueño lo cambia | Adoptada (v0.4.0) |
| P-18 | ¿Hay consumo interno? | Sí: tipo `internal_use` | Adoptada (v0.4.0) |
| P-19 | ¿Las alertas de vencimiento son iguales para todo? | No: configurables por categoría (§5.9) | Adoptada (v0.4.0) |
| P-20 | ¿Cuántas sucursales y depósitos? | Una sucursal y un depósito: no hace falta modelar ubicaciones | Adoptada (v0.4.0) |

---

## 14. Revisión y aprobación

El contrato pasa a **APROBADO** cuando:

1. El responsable de backend lo lee completo y registra en el PR que concuerda
   (o lista las diferencias y se resuelven en este documento).
2. `efacelli` aprueba y fusiona el PR.

Cualquier cambio posterior sube la versión, se hace por Pull Request y requiere
volver a registrar la concordancia.

| Responsable | Área | Versión revisada | Fecha | Resultado | Observaciones |
|---|---|---|---|---|---|
| `efacelli` | Frontend + aprobación de PR | 0.4.0 | 2026-11-15 | Propone | Respuestas de la segunda visita. Redacción delegada a Claude Code |
| `ChinoNader18` | Backend | 0.3.1 | 2026-11-14 | Concuerda con observaciones | **Falta revisar la v0.4.0** |

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 0.1.0 | 2026-11-14 | Borrador inicial propuesto por Claude Code para revisión |
| 0.2.0 | 2026-11-14 | Responsables y flujo de aprobación; respuestas P-01 a P-14 adoptadas (salvo P-02); P-15 provisional restrictiva; código `BATCH_EXPIRED` |
| 0.3.0 | 2026-11-14 | Requisitos del cliente: `sale_unit` agrega `pack`, `box`, `other`; `brand_id` obligatoria; RPC `create_product` con stock inicial opcional y `products.creation_key`; código `SKU_ALREADY_EXISTS`; niveles de alerta en la UI (§4.4) |
| 0.3.1 | 2026-11-14 | Revisión del backend: permisos iguales para todo usuario activo (§4.1, §9, P-10, P-11); perfiles legibles por todos; origen de `full_name` y primer `admin` (§5.1); columnas de auditoría fijadas por la base (§2.5); nombres de índices únicos (§5.2–5.5); bloqueo de cambio de `sale_unit` con movimientos; reglas de reversión (§5.7, §8.3); fechas con `default null` y código `INVALID_DATE` (§8, §8.6); campos comparados en la idempotencia (§8.5); `creation_key` siempre (§8.4); `next_expiry_status` nulo (§7.2); P-15 adoptada |
| 0.4.0 | 2026-11-15 | Segunda visita al cliente: permisos por rol dueño/encargado/empleado (§4.1, §9); precios sin IVA y `sale_price_with_vat` (§5.5, P-02); SKU generado por la base (§5.5, §8.4); `units_per_box` y desglose de cajas en `v_product_stock` (§3, §5.5, §7.2); `register_product_movement` con lotes por vencimiento y `operation_key` (§8.7); tipo `internal_use` (§4.3); alertas configurables por categoría con `expiry_alert_settings` y estados `expires_urgent/soon/upcoming` (§4.4, §5.9); vencimiento obligatorio y código `EXPIRY_REQUIRED` (§8.1); dashboard `v_inventory_summary` (§7.4); transición desde las migraciones fusionadas (§8.8); P-17 a P-20 |
