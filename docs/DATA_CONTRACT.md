# Contrato de datos — Etapa 1

| Campo | Valor |
|---|---|
| Versión | 0.3.0 |
| Estado | **PROPUESTO — PENDIENTE DE CONCORDANCIA DEL BACKEND** |
| Alcance | Productos, lotes, vencimientos, stock y movimientos |
| Fuentes | `CLAUDE.md`, skills `supabase-database`, `inventory-domain`, `security-rls`, `testing-migrations` |

> Este documento no está aprobado hasta que ambos responsables completen la
> sección [Revisión y aprobación](#14-revisión-y-aprobación). Mientras tanto
> no se aplican migraciones ni se fusiona código que dependa de él.

### Responsables

| Área | Responsable | Es dueño de |
|---|---|---|
| Frontend | `efacelli` | `src/`, UI, consumo de vistas y RPC, tipos generados |
| Backend | colega (cuenta GitHub a completar) | `supabase/` (migraciones, RLS, vistas, RPC, seeds, tests de DB) |
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
| `created_by` | `uuid` → `profiles.id` | sí* | `auth.uid()` |
| `updated_at` | `timestamptz` | no | `now()` (trigger en UPDATE) |
| `updated_by` | `uuid` → `profiles.id` | sí* | `auth.uid()` (trigger en UPDATE) |

\* Nulable solo para datos de semilla/migración; las escrituras de la app siempre
lo completan.

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
4. **Todo stock pertenece a un lote.** Un producto no perecedero tiene lotes con
   `expires_on = NULL`. Así no hay dos caminos (con lote / sin lote) ni dos saldos.
   Ver [P-01](#13-preguntas-abiertas).

**Invariante verificable** (se testea y puede correrse como chequeo de
conciliación):

```sql
-- Para cada lote, el saldo materializado coincide con el ledger
quantity_available = SUM(signed_quantity) de sus movimientos
```

---

## 4. Enums

### 4.1 `app_role`

| Valor | Descripción propuesta |
|---|---|
| `admin` | Gestiona usuarios, roles y catálogo; puede revertir movimientos |
| `manager` | Encargado: catálogo, lotes, todos los movimientos |
| `staff` | Empleado: consulta, ingresos y salidas; no ajustes ni reversiones |

Permisos por rol a confirmar ([P-10](#13-preguntas-abiertas)).

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

> **Inconsistencia resuelta:** el requisito decía "ajustes" y "devoluciones" sin
> dirección. Un ajuste puede sumar o restar y una devolución puede ser de cliente
> (suma) o a proveedor (resta). Se separan en dos tipos cada uno para que la
> dirección no dependa del signo de la cantidad. Ver [P-03](#13-preguntas-abiertas).

### 4.4 `expiry_status` (solo en vistas, no se guarda)

Se calcula en orden de precedencia; el primer caso que se cumple gana:

| Orden | Valor | Condición |
|---|---|---|
| 1 | `depleted` | `quantity_available = 0` |
| 2 | `no_expiry` | `expires_on IS NULL` |
| 3 | `expired` | `expires_on < hoy` |
| 4 | `expires_7` | `expires_on <= hoy + 7` |
| 5 | `expires_15` | `expires_on <= hoy + 15` |
| 6 | `expires_30` | `expires_on <= hoy + 30` |
| 7 | `ok` | resto |

- Un lote agotado nunca alerta, aunque esté vencido (requisito).
- Lo que vence **hoy** cuenta como `expires_7`, no como `expired`
  ([P-08](#13-preguntas-abiertas)).
- Las alertas se calculan, no se guardan como filas, así que no pueden
  duplicarse.
- La UI muestra texto o ícono además del color (accesibilidad).

**Niveles de alerta en la UI** (presentación; no es un dato de la base):

| `expiry_status` | Nivel en la UI | Texto |
|---|---|---|
| `expires_30`, `expires_15` | `warning` | Próximo a vencer |
| `expires_7` | `urgent` | Vencimiento urgente |
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
- Se usa `ON DELETE RESTRICT` porque los movimientos referencian al usuario: no
  se pierde la trazabilidad. Para dar de baja a alguien se usa `is_active = false`.

### 5.2 `categories`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | `CHECK (length(trim(name)) between 1 and 80)`; único sin distinguir mayúsculas: `unique index on lower(trim(name))` |
| `is_active` | `boolean` | no | `true` | — |
| columnas comunes | | | | §2.5 |

Lista plana, sin subcategorías en la Etapa 1 ([P-12](#13-preguntas-abiertas)).

### 5.3 `brands`

Igual que `categories` (`id`, `name` único sin distinguir mayúsculas,
`is_active`, columnas comunes).

### 5.4 `suppliers`

Referencia mínima; el módulo completo de proveedores y compras es de una etapa
futura.

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | 1–120 caracteres; único sin distinguir mayúsculas |
| `tax_id` | `text` | sí | — | CUIT de 11 dígitos sin guiones: `CHECK (tax_id ~ '^[0-9]{11}$')`; único si no es nulo |
| `phone` | `text` | sí | — | — |
| `email` | `text` | sí | — | Validación básica de formato |
| `notes` | `text` | sí | — | — |
| `is_active` | `boolean` | no | `true` | — |
| columnas comunes | | | | §2.5 |

### 5.5 `products`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `sku` | `text` | no | — | Único sin distinguir mayúsculas: `unique index products_sku_key on upper(sku)`; `CHECK (sku = trim(sku) and length(sku) between 1 and 40)` ([P-05](#13-preguntas-abiertas)) |
| `barcode` | `text` | sí | — | `CHECK (barcode ~ '^[0-9]{8,14}$')`; único parcial `WHERE barcode IS NOT NULL`. Sin lector en la Etapa 1 |
| `name` | `text` | no | — | 1–150 caracteres |
| `description` | `text` | sí | — | — |
| `category_id` | `uuid` | no | — | FK → `categories.id` ([P-06](#13-preguntas-abiertas)) |
| `brand_id` | `uuid` | no | — | FK → `brands.id` (obligatoria desde v0.3.0, [P-06](#13-preguntas-abiertas)) |
| `supplier_id` | `uuid` | sí | — | FK → `suppliers.id`; proveedor habitual |
| `sale_unit` | `sale_unit` | no | `'unit'` | — |
| `cost_price` | `numeric(12,2)` | no | — | `CHECK (cost_price >= 0)` |
| `sale_price` | `numeric(12,2)` | no | — | `CHECK (sale_price >= 0)` |
| `vat_rate` | `numeric(4,2)` | no | `21.00` | `CHECK (vat_rate in (10.50, 21.00))` ([P-02](#13-preguntas-abiertas)) |
| `boxes_quantity` | `integer` | no | `0` | `CHECK (>= 0)`. Manual, **independiente** del stock en unidades |
| `min_stock` | `numeric(12,3)` | no | `0` | `CHECK (>= 0)` |
| `is_active` | `boolean` | no | `true` | — |
| `image_path` | `text` | sí | — | Ruta en el bucket privado `product-images`, **no** una URL pública |
| `creation_key` | `uuid` | sí | — | `UNIQUE`. Clave de idempotencia del alta; la completa solo `create_product` (§8.4) |
| columnas comunes | | | | §2.5 |

- **No hay** columna de stock (§3).
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
| `expires_on` | `date` | sí | — | `NULL` = sin vencimiento |
| `quantity_initial` | `numeric(12,3)` | no | — | `CHECK (> 0)`; se fija al crear el lote y no cambia |
| `quantity_available` | `numeric(12,3)` | no | — | `CHECK (>= 0)`. **Solo lo modifican las RPC** |
| `notes` | `text` | sí | — | Observaciones |
| columnas comunes | | | | §2.5 |

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
| `idempotency_key` | `uuid` | no | — | `UNIQUE`. Lo genera el cliente una vez por operación y lo reutiliza en los reintentos |
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

---

## 6. Diagrama de relaciones

```
auth.users 1─1 profiles
profiles   1─N (created_by / updated_by en todas las tablas)

categories 1─N products
brands     1─N products        (opcional)
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
| `next_expiry_status` | `expiry_status` | Estado del lote que vence primero con stock |
| `active_batches_count` | `integer` | Lotes con `quantity_available > 0` |
| `is_low_stock` | `boolean` | `stock_quantity <= min_stock` ([P-08](#13-preguntas-abiertas)) |

### 7.3 `v_product_list`

Lo que lee la pantalla de listado: columnas de `products` más `category_name`,
`brand_name`, `supplier_name` y las de `v_product_stock`. La búsqueda, los
filtros, el orden y la paginación se hacen sobre esta vista; las métricas del
dashboard también salen de ella, sin repetir las reglas en React.

---

## 8. Funciones RPC (escritura de stock)

Todas: `SECURITY DEFINER`, `SET search_path = ''`, nombres calificados, validan
rol y `is_active` del usuario, una transacción por llamada, `EXECUTE` otorgado
solo a `authenticated`.

### 8.1 `receive_stock` — ingreso con lote nuevo

```
receive_stock(
  p_idempotency_key uuid,
  p_product_id      uuid,
  p_quantity        numeric,
  p_received_on     date    default hoy (AR),
  p_expires_on      date    default null,
  p_batch_number    text    default null,
  p_notes           text    default null
) returns stock_movements
```

Crea el lote (`quantity_initial = quantity_available = p_quantity`) y el
movimiento `entry` en una sola transacción.

### 8.2 `register_stock_movement` — cualquier movimiento sobre un lote existente

```
register_stock_movement(
  p_idempotency_key uuid,
  p_batch_id        uuid,
  p_movement_type   movement_type,
  p_quantity        numeric,
  p_reason          text        default null,
  p_notes           text        default null,
  p_occurred_at     timestamptz default now()
) returns stock_movements
```

`product_id` se toma del lote, no del cliente. Bloquea el lote con
`FOR UPDATE`, valida que el saldo no quede negativo, actualiza
`quantity_available` e inserta el movimiento.

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

### 8.4 `create_product` — alta de producto con stock inicial opcional

```
create_product(
  p_idempotency_key  uuid,
  p_sku              text,
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
  p_min_stock        numeric default 0,
  p_is_active        boolean default true,
  p_image_path       text    default null,
  p_initial_quantity numeric default null,
  p_received_on      date    default hoy (AR),
  p_expires_on       date    default null,
  p_batch_number     text    default null
) returns products
```

- Crea el producto y, si `p_initial_quantity > 0`, su primer lote y el
  movimiento `entry`, todo en una transacción: o se crea todo o nada.
- Es la única forma de dar de alta un producto: el `INSERT` directo sobre
  `products` está revocado. La edición posterior sí es `UPDATE` directo (con
  RLS), y nunca toca stock.
- Idempotencia: con stock inicial, la clave queda en el movimiento (§8.5). Sin
  stock inicial, un reintento con la misma clave y el mismo SKU devuelve el
  producto ya creado; un SKU existente creado con otra clave da
  `SKU_ALREADY_EXISTS`. Para eso se guarda la clave en
  `products.creation_key uuid UNIQUE NULL` (nulable para filas viejas o de
  semilla; el cliente nunca la escribe directamente).
- `p_initial_quantity` nula o 0 → el producto se crea sin lotes (stock 0).

### 8.5 Idempotencia

- Si `p_idempotency_key` ya existe **con los mismos datos**, se devuelve el
  movimiento existente sin crear otro (reintento seguro).
- Si existe **con datos distintos**, se lanza `IDEMPOTENCY_CONFLICT`.
- El cliente genera la clave con `crypto.randomUUID()` al abrir el formulario y
  la conserva hasta tener una respuesta definitiva. Esto también sirve para la
  futura cola offline.

### 8.6 Códigos de error

Se lanzan con `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODIGO>'`.
El frontend traduce el código a español; no muestra mensajes crudos de la base.

| Código | Cuándo |
|---|---|
| `NOT_AUTHORIZED` | Rol sin permiso o usuario inactivo |
| `PRODUCT_NOT_FOUND` / `BATCH_NOT_FOUND` / `MOVEMENT_NOT_FOUND` | ID inexistente o no visible |
| `PRODUCT_INACTIVE` | Movimiento sobre un producto inactivo ([P-13](#13-preguntas-abiertas)) |
| `INVALID_QUANTITY` | Cantidad ≤ 0, o con decimales en una unidad de cantidades enteras (`unit`, `pack`, `box`, `other`) |
| `SKU_ALREADY_EXISTS` | `create_product` con un SKU que ya existe (y no es un reintento idéntico) |
| `INSUFFICIENT_STOCK` | La salida dejaría el lote en negativo |
| `REASON_REQUIRED` | Falta el motivo en un tipo que lo exige |
| `INVALID_MOVEMENT_TYPE` | `entry` vía `register_stock_movement` (usar `receive_stock`) |
| `ALREADY_REVERSED` | El movimiento ya tiene compensación |
| `BATCH_EXPIRED` | Salida de un lote vencido con un tipo distinto de `shrinkage`, `damage` o `supplier_return` ([P-15](#13-preguntas-abiertas)) |
| `IDEMPOTENCY_CONFLICT` | Clave reutilizada con otros datos |

Los errores de restricciones (`23505` unique, `23514` check, `23503` FK) se
mapean en el frontend: por ejemplo, `23505` sobre `products_sku_key` →
"El SKU ya existe".

---

## 9. Seguridad (resumen de RLS propuesta)

RLS activada en todas las tablas del esquema `public`. Propuesta a confirmar en
[P-10](#13-preguntas-abiertas):

| Tabla | `staff` | `manager` | `admin` |
|---|---|---|---|
| `profiles` | lee el propio | lee todos | lee todos, cambia rol y activo |
| `categories`, `brands`, `suppliers` | lee | lee / crea / edita | lee / crea / edita |
| `products` | lee | lee / crea (solo vía `create_product`) / edita | ídem |
| `product_batches` | lee | lee; edita `batch_number`, `expires_on`, `notes` | ídem |
| `stock_movements` | lee; RPC `entry`/`exit` | lee; todas las RPC salvo revertir | todas |
| `audit_log` | — | — | lee |

- Ningún rol hace `INSERT`/`UPDATE`/`DELETE` directo sobre `stock_movements` ni
  sobre `product_batches.quantity_*`.
- Usuarios `anon`: sin acceso a ninguna tabla.
- Bucket `product-images`: privado; lectura para `authenticated` y escritura
  para `manager`/`admin`.

---

## 10. Inconsistencias detectadas en los requisitos

| # | Requisito | Problema | Propuesta |
|---|---|---|---|
| I-01 | "Stock actual con una única fuente de verdad" + lotes con cantidad disponible | Si existen `products.stock` y `product_batches.quantity_available`, hay dos verdades que pueden divergir | Ledger + saldo por lote; el stock del producto es una vista (§3) |
| I-02 | "Lote cuando corresponda" | Movimientos con y sin lote obligan a llevar stock a dos niveles | Todo stock en lotes; los no perecederos usan lotes sin vencimiento |
| I-03 | "Ajustes" y "devoluciones" | Dirección ambigua | Tipos separados con dirección fija (§4.3) |
| I-04 | "Unidad de venta" | Si hay productos por peso, las cantidades enteras no alcanzan | `numeric(12,3)` y validación de enteros para `unit` |
| I-05 | "Costo y precio de venta" + IVA | No se dice si los precios incluyen IVA | Pregunta P-02; no se asume |
| I-06 | "Cajas manuales e independientes" | Las cajas no siguen a los movimientos y se desactualizan sin aviso | Columna manual auditada en `audit_log`; la UI muestra cuándo se actualizó |
| I-07 | "Vencido" | `current_date` en UTC adelanta el vencimiento 3 horas | "Hoy" en la zona horaria de Buenos Aires (§2.4) |
| I-08 | "Stock mínimo" / "stock bajo" | No se define si es `<` o `<=`, ni qué pasa con mínimo 0 | `<=` propuesto; pregunta P-08 |
| I-09 | "Fecha" del movimiento | ¿Fecha real o de registro? ¿Se permiten fechas pasadas? | `occurred_at` y `created_at` separados; pregunta P-11 |
| I-10 | "Auditar operaciones relevantes" | Los movimientos se auditan, pero los cambios de precio o cajas no | Tabla `audit_log` (§5.8) |
| I-11 | "Preparar para futuras ventas" | Una salida sin elegir lote necesita una regla de asignación | Pregunta P-14 (FEFO); por ahora el usuario elige el lote |

---

## 11. Fuera de alcance (no crear todavía)

Compras, recepción formal y costo por lote; márgenes y aumentos; descuentos;
clientes y cuentas corrientes; ventas, caja y tickets; ARCA; offline/PWA;
historial de precios separado del `audit_log`. Todas se agregan después con
migraciones compatibles hacia atrás.

---

## 12. Pruebas que este contrato exige

- SKU duplicado (incluido `abc` vs `ABC`) → `23505`.
- Cantidad 0 y negativa → `INVALID_QUANTITY`.
- Salida mayor al saldo → `INSUFFICIENT_STOCK` y el saldo no cambia.
- Lote agotado → `depleted` y sin alerta.
- Producto sin vencimiento → `no_expiry`.
- Vencimiento pasado → `expired`; vencimiento hoy → `expires_7`.
- Lote de otro producto → la FK compuesta lo rechaza.
- `UPDATE`/`DELETE` sobre `stock_movements` → rechazado.
- Mismo `idempotency_key` dos veces → un solo movimiento; con otros datos →
  `IDEMPOTENCY_CONFLICT`.
- Dos salidas concurrentes sobre el mismo lote → nunca saldo negativo.
- Revertir dos veces → `ALREADY_REVERSED`.
- `exit` sobre un lote vencido → `BATCH_EXPIRED`; `shrinkage` sobre el mismo
  lote → permitido.
- `occurred_at` a futuro o con más de 7 días de atraso → rechazado; con 3 días
  de atraso por `staff` → `NOT_AUTHORIZED`.
- Movimiento `exit` sobre producto inactivo → `PRODUCT_INACTIVE`.
- Cantidad con decimales en producto `unit` → `INVALID_QUANTITY`.
- Conciliación: `quantity_available` = suma del ledger para todos los lotes.
- RLS: cada fila de §9 probada con un usuario permitido y uno denegado; `anon`
  sin acceso; un `staff` no puede cambiarse el rol.
- Migraciones aplicadas sobre una base con datos ficticios previos: los conteos
  y las relaciones se conservan.

---

## 13. Preguntas abiertas

Desde la versión 0.2.0, las respuestas marcadas como **Adoptada** son la regla
vigente para implementar. Pueden cambiarse más adelante con un PR que modifique
este documento y una migración nueva.

| # | Pregunta | Respuesta | Estado |
|---|---|---|---|
| P-01 | ¿Todo stock se registra en lotes, aunque el producto no venza? | Sí | Adoptada |
| P-02 | ¿`cost_price` y `sale_price` incluyen IVA? | Sin definir: consultar al contador | **Pendiente.** No cambia columnas ni tipos; sí cómo la UI rotula los precios. Debe resolverse antes de mostrar precios como finales y antes de márgenes o ventas |
| P-03 | ¿Las devoluciones son de clientes, a proveedores o ambas? | Ambas, como tipos separados | Adoptada |
| P-04 | ¿Hay productos por peso o volumen? ¿Qué unidades? | `unit`, `kg`, `l`, `pack`, `box`, `other` (v0.3.0, pedido del cliente) | Adoptada |
| P-05 | ¿El SKU tiene formato (largo, caracteres)? ¿Distingue mayúsculas? | 1–40 caracteres, no distingue mayúsculas | Adoptada |
| P-06 | ¿Categoría y marca son obligatorias? | Ambas obligatorias (v0.3.0: el pedido del cliente no marca la marca como opcional). Para productos sin marca se usa una marca "Sin marca" | Adoptada |
| P-16 | ¿El alta de producto incluye stock inicial? | Sí, opcional, mediante `create_product` (§8.4), que crea lote y movimiento `entry` | Adoptada |
| P-07 | ¿El número de lote debe ser único por producto? | No (el mismo lote puede llegar en dos entregas) | Adoptada |
| P-08 | ¿Stock bajo es `<=` o `<` al mínimo? ¿Lo que vence hoy está vencido? | `<=`; lo que vence hoy está por vencer | Adoptada |
| P-09 | ¿Se rechaza `expires_on` anterior a `received_on`? | No; solo advertencia en la UI | Adoptada |
| P-10 | ¿Qué roles hay y qué puede hacer cada uno? | Tabla §9 | Adoptada |
| P-11 | ¿Se permite cargar movimientos con fecha pasada? ¿Hasta cuánto? | Sí, hasta 7 días, solo `manager`/`admin`; nunca a futuro | Adoptada |
| P-12 | ¿Hacen falta subcategorías? | No en la Etapa 1 | Adoptada |
| P-13 | ¿Se permiten movimientos sobre productos inactivos? | Solo salidas `shrinkage`/`damage`/`supplier_return` | Adoptada |
| P-14 | En salidas, ¿se elige el lote o se aplica primero el que vence antes (FEFO)? | El usuario elige; la UI sugiere el que vence primero | Adoptada |
| P-15 | ¿Se puede sacar de un lote vencido algo que no sea merma? | No: solo `shrinkage`, `damage` o `supplier_return` (`BATCH_EXPIRED`). Es la opción más restrictiva; se relaja si el dueño lo decide | **Provisional**, a confirmar con el dueño |

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
| `efacelli` | Frontend + aprobación de PR | 0.3.0 | 2026-11-14 | Propone | Delegó la redacción a Claude Code |
| _(colega)_ | Backend | | | _pendiente_ | |

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 0.1.0 | 2026-11-14 | Borrador inicial propuesto por Claude Code para revisión |
| 0.2.0 | 2026-11-14 | Responsables y flujo de aprobación; respuestas P-01 a P-14 adoptadas (salvo P-02); P-15 provisional restrictiva; código `BATCH_EXPIRED` |
| 0.3.0 | 2026-11-14 | Requisitos del cliente: `sale_unit` agrega `pack`, `box`, `other`; `brand_id` obligatoria; RPC `create_product` con stock inicial opcional y `products.creation_key`; código `SKU_ALREADY_EXISTS`; niveles de alerta en la UI (§4.4) |
