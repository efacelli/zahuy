# Contrato de datos — Etapa 1

| Campo | Valor |
|---|---|
| Versión | 0.3.1 |
| Estado | **PROPUESTO — EL BACKEND CONCUERDA CON LAS OBSERVACIONES DE v0.3.1; PENDIENTE DE APROBACIÓN DE `efacelli`** |
| Alcance | Productos, lotes, vencimientos, stock y movimientos |
| Fuentes | `CLAUDE.md`, skills `supabase-database`, `inventory-domain`, `security-rls`, `testing-migrations` |

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

| Valor | Descripción |
|---|---|
| `admin` | Todo lo operativo, y además gestiona usuarios (rol y activo) y lee `audit_log` |
| `manager` | Mismos permisos operativos que `staff` (reservado para una regla futura) |
| `staff` | Empleado: todas las operaciones de la Etapa 1 |

Desde v0.3.1 (respuesta del dueño): **todos los empleados activos pueden hacer
todas las operaciones** (catálogos, alta y edición de productos, todos los
movimientos y reversiones, ver costos). Los tres valores del enum se conservan
para poder diferenciar permisos más adelante (por ejemplo, el rol del dueño)
sin cambiar el tipo. Ver §9 y [P-10](#13-preguntas-abiertas).

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
| `sku` | `text` | no | — | Único sin distinguir mayúsculas: `unique index products_sku_key on upper(sku)`; `CHECK (sku = trim(sku) and length(sku) between 1 and 40)` ([P-05](#13-preguntas-abiertas)) |
| `barcode` | `text` | sí | — | `CHECK (barcode ~ '^[0-9]{8,14}$')`; único parcial `products_barcode_key` `WHERE barcode IS NOT NULL`. Sin lector en la Etapa 1 |
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
| `expires_on` | `date` | sí | — | `NULL` = sin vencimiento |
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

---

## 6. Diagrama de relaciones

```
auth.users 1─1 profiles
profiles   1─N (created_by / updated_by en todas las tablas)

categories 1─N products
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

La vista incluye **todos** los productos: uno sin lotes tiene `stock_quantity = 0`
y `active_batches_count = 0`. Consecuencia de P-08: con `min_stock = 0`, un
producto sin stock figura con `is_low_stock = true`.

### 7.3 `v_product_list`

Lo que lee la pantalla de listado: columnas de `products` más `category_name`,
`brand_name`, `supplier_name` y las de `v_product_stock`. La búsqueda, los
filtros, el orden y la paginación se hacen sobre esta vista; las métricas del
dashboard también salen de ella, sin repetir las reglas en React.

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
  p_expires_on      date    default null,
  p_batch_number    text    default null,
  p_notes           text    default null
) returns stock_movements
```

Crea el lote (`quantity_initial = quantity_available = p_quantity`) y el
movimiento `entry` en una sola transacción. `p_received_on` no puede ser futura
(`INVALID_DATE`).

### 8.2 `register_stock_movement` — cualquier movimiento sobre un lote existente

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
- Idempotencia (v0.3.1): la clave se guarda **siempre** en
  `products.creation_key uuid UNIQUE NULL` (nulable para filas viejas o de
  semilla; el cliente nunca la escribe directamente) y, si hay stock inicial,
  también como `idempotency_key` del movimiento `entry`. Un reintento con la
  misma clave y el mismo SKU (sin distinguir mayúsculas) devuelve el producto ya
  creado; la misma clave con otro SKU da `IDEMPOTENCY_CONFLICT`; un SKU
  existente creado con otra clave da `SKU_ALREADY_EXISTS`.
- Un código de barras repetido devuelve `23505` sobre `products_barcode_key`.
- `p_received_on` no puede ser futura (`INVALID_DATE`).
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
  | `create_product` | `sku` (sin distinguir mayúsculas) |

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
| `SKU_ALREADY_EXISTS` | `create_product` con un SKU que ya existe (y no es un reintento idéntico) |
| `INSUFFICIENT_STOCK` | La salida dejaría el lote en negativo |
| `REASON_REQUIRED` | Falta el motivo en un tipo que lo exige |
| `INVALID_MOVEMENT_TYPE` | `entry` vía `register_stock_movement` (usar `receive_stock`); revertir un movimiento que ya es una reversión |
| `ALREADY_REVERSED` | El movimiento ya tiene compensación |
| `BATCH_EXPIRED` | Salida de un lote vencido con un tipo distinto de `shrinkage`, `damage` o `supplier_return` ([P-15](#13-preguntas-abiertas)) |
| `IDEMPOTENCY_CONFLICT` | Clave reutilizada con otros datos |
| `INVALID_DATE` | `occurred_at` futura o con más de 7 días de atraso; `received_on` futura (v0.3.1; **el frontend debe agregar su traducción**) |

Los errores de restricciones (`23505` unique, `23514` check, `23503` FK) se
mapean en el frontend: por ejemplo, `23505` sobre `products_sku_key` →
"El SKU ya existe".

---

## 9. Seguridad (resumen de RLS propuesta)

RLS activada en todas las tablas del esquema `public`. Desde v0.3.1 (respuesta
del dueño, [P-10](#13-preguntas-abiertas)) los permisos operativos son iguales
para todo usuario **activo**; solo la gestión de usuarios y la auditoría quedan
para `admin`:

| Tabla | Usuario activo (`staff`, `manager`, `admin`) | Solo `admin` | Usuario inactivo |
|---|---|---|---|
| `profiles` | lee todos (`id`, `full_name`, `role`, `is_active`) | edita `full_name`, `role`, `is_active` | lee solo el propio |
| `categories`, `brands`, `suppliers` | lee / crea / edita | — | — |
| `products` | lee / crea (solo vía `create_product`) / edita | — | — |
| `product_batches` | lee; edita `batch_number`, `expires_on`, `notes` | — | — |
| `stock_movements` | lee; las cuatro RPC, incluida la reversión | — | — |
| `audit_log` | — | lee | — |

- Todos los usuarios activos leen los perfiles porque el historial muestra quién
  hizo cada movimiento.
- Nadie hace `DELETE` desde la app, ni `INSERT`/`UPDATE`/`DELETE` directo sobre
  `stock_movements`, ni escribe `product_batches.quantity_*`.
- Usuarios `anon`: sin acceso a ninguna tabla, vista ni función.
- "Activo" se comprueba en la base (`profiles.is_active`) en cada política y en
  cada RPC, no en React.
- Bucket `product-images`: privado; lectura y escritura para usuarios activos.

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

- SKU duplicado (incluido `abc` vs `ABC`): `SKU_ALREADY_EXISTS` en
  `create_product`; `23505` sobre `products_sku_key` al editar el SKU de un
  producto existente.
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
- `occurred_at` a futuro o con más de 7 días de atraso → `INVALID_DATE`; con 3
  días de atraso → permitido para cualquier usuario activo.
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
  sin acceso; un usuario que no es `admin` no puede cambiar su rol ni el de otro.
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
| P-10 | ¿Qué roles hay y qué puede hacer cada uno? | Tabla §9. v0.3.1 (dueño): todos los empleados hacen todas las operaciones; `admin` además gestiona usuarios y lee la auditoría | Adoptada. Pendiente de la segunda visita: si el dashboard del negocio es solo para el dueño |
| P-11 | ¿Se permite cargar movimientos con fecha pasada? ¿Hasta cuánto? | Sí, hasta 7 días, cualquier usuario activo (v0.3.1, consecuencia de P-10); nunca a futuro | Adoptada |
| P-12 | ¿Hacen falta subcategorías? | No en la Etapa 1 | Adoptada |
| P-13 | ¿Se permiten movimientos sobre productos inactivos? | Solo salidas `shrinkage`/`damage`/`supplier_return` | Adoptada |
| P-14 | En salidas, ¿se elige el lote o se aplica primero el que vence antes (FEFO)? | El usuario elige; la UI sugiere el que vence primero | Adoptada |
| P-15 | ¿Se puede sacar de un lote vencido algo que no sea merma? | No: solo `shrinkage`, `damage` o `supplier_return` (`BATCH_EXPIRED`). El dueño confirmó que lo vencido se tira y nunca se vende | Adoptada (v0.3.1). Pendiente menor: si algún proveedor retira vencidos (ya cubierto por `supplier_return`) |

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
| `ChinoNader18` | Backend | 0.3.1 | 2026-11-14 | Concuerda con observaciones | Las observaciones sobre la v0.3.0 están resueltas en la v0.3.1 (ver historial). Revisión delegada a Claude Code |

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 0.1.0 | 2026-11-14 | Borrador inicial propuesto por Claude Code para revisión |
| 0.2.0 | 2026-11-14 | Responsables y flujo de aprobación; respuestas P-01 a P-14 adoptadas (salvo P-02); P-15 provisional restrictiva; código `BATCH_EXPIRED` |
| 0.3.0 | 2026-11-14 | Requisitos del cliente: `sale_unit` agrega `pack`, `box`, `other`; `brand_id` obligatoria; RPC `create_product` con stock inicial opcional y `products.creation_key`; código `SKU_ALREADY_EXISTS`; niveles de alerta en la UI (§4.4) |
| 0.3.1 | 2026-11-14 | Revisión del backend: permisos iguales para todo usuario activo (§4.1, §9, P-10, P-11); perfiles legibles por todos; origen de `full_name` y primer `admin` (§5.1); columnas de auditoría fijadas por la base (§2.5); nombres de índices únicos (§5.2–5.5); bloqueo de cambio de `sale_unit` con movimientos; reglas de reversión (§5.7, §8.3); fechas con `default null` y código `INVALID_DATE` (§8, §8.6); campos comparados en la idempotencia (§8.5); `creation_key` siempre (§8.4); `next_expiry_status` nulo (§7.2); P-15 adoptada |
