# Contrato de datos — Etapa 1

| Campo | Valor |
|---|---|
| Versión | 0.6.3 (propuesta de la §15; lo demás sigue en 0.5.2) |
| Estado | **VIGENTE — EL BACKEND CONCUERDA CON OBSERVACIONES (v0.5.2, §14)** |
| Alcance | Productos, lotes, vencimientos, stock y movimientos. **Propuesta:** ventas y caja (§15, sin implementar) |
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
| `name` | `text` | no | — | `CHECK (length(trim(name)) between 1 and 80)`; único sin distinguir mayúsculas **ni tildes** (v0.4.0): `unique index categories_name_key on lower(private.unaccent_text(trim(name)))` |
| `is_active` | `boolean` | no | `true` | — |
| columnas comunes | | | | §2.5 |

Lista plana, sin subcategorías en la Etapa 1 ([P-12](#13-preguntas-abiertas)).

**Tildes (v0.4.0):** en la prueba con la base real, "lacteos" se guardó como
una categoría distinta de "Lácteos". Los nombres de `categories`, `brands` y
`suppliers` pasan a ser únicos también sin distinguir tildes. Se usa la
extensión `unaccent` envuelta en una función `IMMUTABLE` (`private.unaccent_text`,
con `search_path` vacío), porque un índice no acepta `unaccent()` directamente.

### 5.3 `brands`

Igual que `categories` (`id`, `name` único sin distinguir mayúsculas con el
índice `brands_name_key`, que desde v0.4.0 tampoco distingue tildes, `is_active`, columnas comunes).

### 5.4 `suppliers`

Referencia mínima; el módulo completo de proveedores y compras es de una etapa
futura.

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | 1–120 caracteres; único sin distinguir mayúsculas **ni tildes** (v0.4.0): `unique index suppliers_name_key on lower(private.unaccent_text(trim(name)))` |
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
| `barcode` | `text` | sí | — | `CHECK (barcode ~ '^[0-9]{8,14}$')`; único parcial `products_barcode_key` `WHERE barcode IS NOT NULL`. Se lee con el lector USB |
| `legacy_code` | `text` | sí | — | v0.5.0 (P-25): código propio del sistema anterior del cliente (ej. `31884325`, `001`). `CHECK (legacy_code = trim(legacy_code) and length(legacy_code) between 1 and 40)`; único parcial `products_legacy_code_key` sobre `upper(legacy_code)` `WHERE legacy_code IS NOT NULL`. Se busca igual que el SKU. Lo edita encargado o dueño |
| `name` | `text` | no | — | 1–150 caracteres |
| `search_name` | `text` | no | generada | v0.5.1: `GENERATED ALWAYS AS (lower(private.unaccent_text(name))) STORED`. Nombre sin tildes y en minúscula para buscar ("lacteos" encuentra "Lácteos"). No se escribe |
| `description` | `text` | sí | — | — |
| `category_id` | `uuid` | no | — | FK → `categories.id` ([P-06](#13-preguntas-abiertas)) |
| `brand_id` | `uuid` | no | — | FK → `brands.id` (obligatoria desde v0.3.0, [P-06](#13-preguntas-abiertas)) |
| `supplier_id` | `uuid` | sí | — | FK → `suppliers.id`; proveedor habitual |
| `sale_unit` | `sale_unit` | no | `'unit'` | — |
| `cost_price` | `numeric(12,2)` | no | — | `CHECK (cost_price >= 0)`. Costo **sin IVA** (v0.4.0) |
| `sale_price` | `numeric(12,4)` | no | — | `CHECK (sale_price >= 0)`. Precio de venta **sin IVA**, el que se carga (v0.4.0). **4 decimales desde v0.5.0 (P-24)**: así cualquier precio final con centavos se reproduce exacto en `sale_price_with_vat` |
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
  el frontend no lo guarda ni lo usa en listados. Solo en el formulario de alta
  muestra una **vista previa** con la misma fórmula, rotulada como estimada,
  mientras el usuario escribe; después de guardar vale el de la base. Margen = `sale_price − cost_price`, ambos sin IVA.
- **Cajas (v0.4.0):** las unidades que están dentro de las cajas **forman parte
  del stock** (§3). `boxes_quantity` dice cuántas de esas unidades están en cajas
  cerradas; no suma stock por sí sola. Ver §7.2.
- **SKU (v0.4.0):** generado por la base con la secuencia `products_sku_seq`.
  El SKU de 6 dígitos sirve también para los productos sin código de barras y,
  más adelante, como código en la balanza. El código propio del sistema
  anterior se conserva aparte en `legacy_code` (v0.5.0, P-25); no reemplaza al SKU.
- **Precio final exacto (v0.5.0, P-24):** con `sale_price` de 4 decimales,
  `sale_price = round(precio_final / (1 + vat_rate / 100), 4)` hace que
  `sale_price_with_vat` devuelva exactamente `precio_final` (el error máximo,
  0,00006, no alcanza a mover el redondeo a centavos).
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
| `action` | `text` | no | `CHECK (action in ('insert','update','delete'))` (`delete` desde v0.4.4, P-22) |
| `old_data` | `jsonb` | sí | — |
| `new_data` | `jsonb` | sí | — |
| `changed_by` | `uuid` | sí | `auth.uid()` |
| `changed_at` | `timestamptz` | no | `now()` |

Solo se lee (rol `admin`), nunca se escribe desde el cliente. No guarda secretos
ni tokens.

En `product_batches` solo se auditan los cambios de `batch_number`, `expires_on`
y `notes` (v0.3.1): los cambios de saldo ya quedan en `stock_movements` y
duplicarlos solo agregaría ruido.

Borrados (v0.4.4, P-22): `expiry_alert_settings` es la única tabla en la que
la app borra filas; su borrado queda con `action = 'delete'`, `old_data` con la
fila borrada y `new_data` nulo.

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

Desde v0.4.2, para la pantalla de Alertas (sin consultas extra por fila), también:

| Columna | Tipo | Origen |
|---|---|---|
| `product_sku` | `text` | `products.sku` |
| `product_name` | `text` | `products.name` |
| `product_is_active` | `boolean` | `products.is_active` |
| `sale_unit` | `sale_unit` | `products.sale_unit` |
| `category_id` | `uuid` | `products.category_id` |
| `category_name` | `text` | `categories.name` |

La pantalla de Alertas filtra `expiry_status IN ('expired', 'expires_urgent',
'expires_soon', 'expires_upcoming')` (nunca agotados ni sin vencimiento), por
`category_id` y por texto en `product_name`/`product_sku`/`batch_number`, y ordena
por `expires_on`, `product_name`, `id`. Conviene un índice que cubra
`expires_on` de los lotes con stock (ya existe `product_batches_expires_on_idx`).

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
`sale_price_with_vat`, `units_per_box` y, desde v0.5.0, `legacy_code` al final; desde v0.5.1, `search_name` después de `legacy_code`). La búsqueda por texto normaliza lo escrito igual (sin tildes, minúscula) y compara contra `search_name`, `sku`, `barcode` y `legacy_code` más `category_name`, `brand_name`,
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
| `shrinkage_quantity_month` | `numeric(14,3)` | Suma de `quantity` de `shrinkage`, `damage` e `internal_use` del mes actual (Argentina), **sin los movimientos anulados** (v0.4.4, P-21). Mezcla unidades de productos distintos |
| `box_mismatch_products` | `integer` | Productos con `has_box_mismatch` |
| `shrinkage_value_month` | `numeric(14,2)` | v0.4.4 (P-21): mismos movimientos que `shrinkage_quantity_month`, valuados `quantity * cost_price` (costo actual del producto, sin IVA; no hay costo por lote todavía). Va al final para no alterar el orden de columnas |

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
  p_batch_number     text    default null,
  p_legacy_code      text    default null    -- v0.5.0 (P-25)
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
- Extensión `unaccent`, función `private.unaccent_text()` y recreación de
  `categories_name_key`, `brands_name_key` y `suppliers_name_key` sin distinguir
  tildes (mismo nombre de índice). Antes de recrearlos, la migración debe
  detectar duplicados existentes y fallar con un mensaje claro en lugar de
  borrar o renombrar datos.
- Función `private.is_manager_or_admin()` y reemplazo de las políticas de
  `INSERT`/`UPDATE` de `categories`, `brands` y `suppliers` para que solo
  escriban encargado y dueño.

### 8.9 Aclaraciones de implementación (v0.4.3)

Describen cómo funciona lo ya implementado; no agregan reglas nuevas. Lo que
requiere una decisión quedó como pregunta abierta (P-21 a P-23).

- **RPC de §8.2, §8.3 y §8.7:** implementadas en la migración
  `20261116170000_rpc_movements_reverse.sql` (prueba `12_rpc_movements_reverse`).
- **Huecos en el SKU:** `products_sku_seq` no devuelve números. Un alta que
  falla después de pedir el número, o una transacción revertida, deja un hueco.
  El SKU es **único, no correlativo**. Un reintento idempotente de
  `create_product` no consume otro número (§8.4).
- **Anular una salida repartida en lotes:** `register_product_movement` puede
  generar varios movimientos con la misma `operation_key`. La reversión
  (§8.3) es **por movimiento**: anular uno devuelve solo lo de ese lote. La UI
  avisa cuántas filas tiene la operación; para deshacerla entera se anula cada
  fila.
- **Movimiento ya anulado:** PostgREST no expone la relación inversa de
  `reverses_movement_id` (FK de la tabla consigo misma). La UI consulta
  `stock_movements?reverses_movement_id=in.(…)` para saber qué filas ya tienen
  anulación; la base igual rechaza la segunda (`ALREADY_REVERSED`).
- **Nombres de FK que usa el frontend** en los `select` embebidos (no
  renombrarlos sin avisar): `stock_movements_batch_product_fkey` (movimiento →
  lote → producto) y `stock_movements_created_by_fkey` (movimiento → autor).
- **Conteo de cajas por el empleado:** permiso por columna
  `UPDATE (boxes_quantity)` más el trigger `products_restrict_staff_update`, que
  lanza `NOT_AUTHORIZED` si alguien que no es encargado ni dueño cambia otra
  columna. Un `UPDATE` que RLS filtra no falla: afecta 0 filas; la UI lo
  informa como falta de permiso.
- **Mermas del mes:** desde v0.4.4 no cuentan los movimientos anulados y se
  muestran también a costo (§7.4, P-21).
- **Auditoría de `expiry_alert_settings`:** altas, ediciones y, desde v0.4.4,
  borrados (§5.8, P-22).
- **`expires_on` al editar un lote:** el permiso por columna deja que encargado
  y dueño lo cambien, también a `NULL`; se mantiene así por decisión (P-23). Al
  crear un lote sigue siendo obligatorio (`EXPIRY_REQUIRED`).
- **Datos locales:** `supabase/seed.sql` carga datos ficticios en `db reset`
  (solo entorno local) y `npm run db:users` crea los usuarios de prueba.
  `src/types/database.ts` se genera con `npm run gen:types` y
  `src/types/contract-check.ts` hace fallar `tsc` si los enums del frontend
  dejan de coincidir con los de la base.

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
clientes y cuentas corrientes; ARCA (ventas y caja: propuesta en §15, v0.6.0); offline/PWA;
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
- Catálogos: "lacteos" contra "Lácteos" (y "LÁCTEOS") → `23505` sobre `categories_name_key`.
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
| P-21 | En "Mermas del mes", ¿se descuentan las mermas anuladas? ¿Se muestra en unidades o en dinero? | Se descuentan los movimientos anulados y se agrega `shrinkage_value_month` (valor a costo) a `v_inventory_summary` (§7.4) | Adoptada (v0.4.4) |
| P-22 | ¿Se audita el borrado de una configuración de alertas por categoría? | Sí: el borrado queda en `audit_log` con `action = 'delete'` (§5.8) | Adoptada (v0.4.4) |
| P-24 | ¿El precio final de góndola tiene que quedar exactamente igual al del sistema anterior? | Sí: `sale_price` pasa a `numeric(12,4)` (§5.5). Con 2 decimales, 2.272 de 13.288 productos del sistema anterior quedaban un centavo distintos | Adoptada (v0.5.0) |
| P-25 | ¿Se conserva el código propio del sistema anterior? | Sí, en `products.legacy_code`, único y buscable; el SKU sigue siendo el de la base (§5.5) | Adoptada (v0.5.0) |
| P-26 | ¿Qué productos del sistema anterior se importan y con qué catálogos? | Los actualizados desde 2025 (unos 3.000 de 13.288 cargados desde 2003), con categoría "Otros" (antes "Sin clasificar", renombrada a pedido de `efacelli`) y marca "Sin clasificar" porque la exportación no las trae; se ordenan después | Adoptada (v0.5.0) |
| P-23 | ¿Se puede quitar el vencimiento (`NULL`) al editar un lote? | Sí: el encargado o el dueño puede quitarlo al editar un lote; queda auditado. La obligación aplica solo al crear lotes (`EXPIRY_REQUIRED`). Se rechazó la propuesta de prohibirlo | Adoptada (v0.4.4) |

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
| `ChinoNader18` | Backend | 0.5.1 | 2026-11-15 | Concuerda con observaciones | Revisadas las versiones 0.4.0 a 0.5.1 y las migraciones `20261116170000` a `20261116220000` contra la base local: todas las pruebas pgTAP y la prueba de concurrencia pasan. Observaciones: (1) P-13 no se cumplía en las RPC de movimientos; corregido en `20261116180000`. (2) P-23 se decidió distinto de lo que propuse; lo acepto. (3) La migración `20261116210000` borra y recrea vistas, una columna generada y una función para cambiar el tipo de `sale_price`: no pierde datos, pero en una base con datos reales conviene aplicarla con backup previo. (4) El bucket `product-images` de §9 todavía no está en `main`: lo propongo en el PR #54. Revisión delegada a Claude Code |

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 0.1.0 | 2026-11-14 | Borrador inicial propuesto por Claude Code para revisión |
| 0.2.0 | 2026-11-14 | Responsables y flujo de aprobación; respuestas P-01 a P-14 adoptadas (salvo P-02); P-15 provisional restrictiva; código `BATCH_EXPIRED` |
| 0.3.0 | 2026-11-14 | Requisitos del cliente: `sale_unit` agrega `pack`, `box`, `other`; `brand_id` obligatoria; RPC `create_product` con stock inicial opcional y `products.creation_key`; código `SKU_ALREADY_EXISTS`; niveles de alerta en la UI (§4.4) |
| 0.3.1 | 2026-11-14 | Revisión del backend: permisos iguales para todo usuario activo (§4.1, §9, P-10, P-11); perfiles legibles por todos; origen de `full_name` y primer `admin` (§5.1); columnas de auditoría fijadas por la base (§2.5); nombres de índices únicos (§5.2–5.5); bloqueo de cambio de `sale_unit` con movimientos; reglas de reversión (§5.7, §8.3); fechas con `default null` y código `INVALID_DATE` (§8, §8.6); campos comparados en la idempotencia (§8.5); `creation_key` siempre (§8.4); `next_expiry_status` nulo (§7.2); P-15 adoptada |
| 0.4.0 | 2026-11-15 | Segunda visita al cliente: permisos por rol dueño/encargado/empleado (§4.1, §9); precios sin IVA y `sale_price_with_vat` (§5.5, P-02); SKU generado por la base (§5.5, §8.4); `units_per_box` y desglose de cajas en `v_product_stock` (§3, §5.5, §7.2); `register_product_movement` con lotes por vencimiento y `operation_key` (§8.7); tipo `internal_use` (§4.3); alertas configurables por categoría con `expiry_alert_settings` y estados `expires_urgent/soon/upcoming` (§4.4, §5.9); vencimiento obligatorio y código `EXPIRY_REQUIRED` (§8.1); dashboard `v_inventory_summary` (§7.4); transición desde las migraciones fusionadas (§8.8); P-17 a P-20; nombres de catálogos únicos sin distinguir tildes (§5.2–5.4) |
| 0.4.1 | 2026-11-15 | Aclaración: la vista previa del precio final en el formulario de alta (§5.5) |
| 0.4.2 | 2026-11-15 | `v_batch_status` suma datos del producto y la categoría para la pantalla de Alertas (§7.1) |
| 0.4.3 | 2026-11-14 | Aclaraciones de implementación sin reglas nuevas (§8.9): RPC de movimientos implementadas, huecos de SKU, anulación por movimiento en salidas repartidas, nombres de FK usados por el frontend, conteo de cajas, métrica de mermas, auditoría de alertas, edición de `expires_on`, seed y tipos generados. Preguntas abiertas P-21 a P-23 |
| 0.4.4 | 2026-11-14 | Decisiones de `efacelli`: P-21 adoptada (mermas del mes sin anuladas y `shrinkage_value_month`, §7.4); P-22 adoptada (`audit_log` admite `delete` y audita el borrado de `expiry_alert_settings`, §5.8); P-23: se mantiene permitido quitar `expires_on` al editar un lote. Migración `20261116200000` |
| 0.5.0 | 2026-11-15 | Importación del sistema anterior: `products.legacy_code` (P-25), `sale_price` con 4 decimales para precio final exacto (P-24), `create_product` recibe `p_legacy_code`, `v_product_list` expone `legacy_code`; criterios de importación (P-26). Migración `20261116210000` |
| 0.5.1 | 2026-11-15 | Búsqueda sin tildes ni mayúsculas: `products.search_name` generada y expuesta al final de `v_product_list` (§5.5, §7.3). Migración `20261116220000` |
| 0.5.2 | 2026-11-15 | Concordancia del backend con las versiones 0.4.0 a 0.5.1 (§14). Sin cambios de reglas |
| 0.6.0 | 2026-11-15 | **Propuesta** de Etapa 5, Ventas y caja (§15): `payment_methods`, `cash_registers`, `cash_sessions`, `sales`, `sale_items`, `sale_payments`, `stock_movements.sale_item_id` y tipo `sale`; RPC `open_cash_session`, `close_cash_session`, `register_sale` (FEFO, idempotente, una sola vez) y `void_sale`; preguntas P-27 a P-38. No se implementa hasta aprobarla |
| 0.6.1 | 2026-11-15 | Decisiones de `efacelli` sobre la propuesta de la §15: P-27 (ticket interno, no es factura), P-30 (redondeo del efectivo a la centena más cercana; `sales.cash_rounding`, `sales_settings.cash_rounding_multiple`, invariante `Σ amount = total_amount + cash_rounding`), P-36 (sin stock negativo; se carga el inventario antes) y aceptación de P-28, P-29, P-31 a P-35, P-37 y P-38. Nuevas preguntas P-39 y P-40. Sigue siendo propuesta |
| 0.6.2 | 2026-11-15 | Precisiones surgidas al implementar la §15 en local (migraciones y pruebas listas, sin PR): código `PRODUCT_PRICE_INVALID`; importes con hasta 2 decimales (tolerancia de coma flotante del cliente); qué cuentan las vistas de caja para el empleado; idempotencia de `void_sale`; y aviso al frontend: agregar `sale` a `MovementType` al regenerar tipos. Sigue siendo propuesta |
| 0.6.3 | 2026-11-16 | Decisiones nuevas de `efacelli`: **P-30 cambia** (se redondea el total de la venta con cualquier medio de pago; el monto es una sugerencia que el cajero puede cambiar y la base solo exige un límite), **P-39 decidida** (menos de la mitad del múltiplo se cobra exacto; desaparece `CASH_AMOUNT_TOO_SMALL`) y P-40 de acuerdo. Renombres: `sales.cash_rounding` → `sales.rounding_amount`, `sales_settings.cash_rounding_multiple` → `rounding_multiple`, vista `cash_rounding_total` → `rounding_total`; nueva `sales.rounding_multiple` (múltiplo vigente al vender). Sigue siendo propuesta |
| 0.7.0 | 2026-11-16 | **Propuesta** (§16): descuentos por cantidad (cada 6 unidades 5 %, editable en la caja, todos los productos) con columnas aditivas en `sales_settings`, `sale_items` y `sales`, `register_sale` con `discount_percent` opcional y código `INVALID_DISCOUNT`; vistas `v_sales_daily` y `v_sales_daily_payments` para las finanzas del dashboard. Preguntas P-41 a P-43; P-41 (tope 30 %) y P-42 (el cajero también puede subirlo) decididas por efacelli el mismo día |

---

## 15. Etapa 5 — Ventas y caja (PROPUESTA v0.6.3)

> **Estado: PROPUESTA con las decisiones de `efacelli` (P-27 a P-40, §15.9; la
> última sobre el redondeo es del 2026-11-16).** No quedan preguntas abiertas.
> Las migraciones ya están escritas y probadas en local (PR de implementación,
> en borrador sobre este); se fusionan después de este PR y pasan primero por
> staging.
> Todo lo vigente de las secciones 1 a 14 sigue igual. Esta sección solo agrega.
> Fuentes: respuestas 38 a 43 del relevamiento (2 cajas a la vez; efectivo,
> débito, crédito, QR y transferencia; cuenta corriente y descuentos por
> cantidad para después) y la sección 4 de `docs/RELEVAMIENTO_RESPUESTAS.md`
> (balanza).

### 15.1 Alcance y principios

**Entra en v0.6.0:** vender (carrito → una venta confirmada), cobrar con uno o
varios medios de pago, descontar stock una sola vez, anular una venta, abrir y
cerrar la caja (turno) con arqueo. Las ventas son **comprobantes internos no
fiscales** (no hay factura ARCA, §15.8). El ticket que imprime el frontend dice
**"NO VÁLIDO COMO FACTURA"**: el negocio sigue facturando con su sistema actual
hasta la etapa 6 (P-27).

**No entra (queda para etapas siguientes, sin bloquearlas):** facturación
ARCA, descuentos por cantidad, cuenta corriente y clientes, devoluciones
posteriores al cierre de caja, retiros de efectivo, lectura de la etiqueta de la
balanza, modo offline.

Principios:

1. **El precio lo pone la base, no el cliente.** `register_sale` recibe producto
   y cantidad; el precio unitario sale de `products.sale_price_with_vat` en el
   momento de la venta y queda copiado (*snapshot*) en el ítem. Cambiar el
   precio del producto después no altera ventas ya hechas.
2. **Una venta descuenta stock una sola vez**, por el mismo mecanismo FEFO que
   §8.7, en la misma transacción. Si algo falla, no queda nada (ni venta, ni
   pagos, ni movimientos).
3. **Ventas, ítems y pagos son inmutables.** Lo único que cambia es el estado a
   `voided` mediante `void_sale`. Se corrige con anulación, no con edición.
4. **Dinero con `numeric(12,2)`** (§2.3). Los totales los calcula PostgreSQL.
5. **Todo cambio de stock sigue pasando por el ledger** (`stock_movements`, §3):
   no existe un segundo camino de descuento.

### 15.2 Enums nuevos y cambios a enums

| Enum | Valores | Notas |
|---|---|---|
| `sale_status` | `completed`, `voided` | Una venta nace `completed`. Pasa a `voided` una sola vez |
| `cash_session_status` | `open`, `closed` | — |
| `movement_type` (existente) | agrega `sale` (dirección −) | Descuento por venta. No exige `reason` (como `exit`). `ALTER TYPE ... ADD VALUE` va en una migración propia, igual que `internal_use` |

`signed_quantity` (§5.7) no cambia: `sale` no está en la lista de entradas, así
que resta. El `CHECK` de `reason` de `stock_movements` ("obligatorio salvo
`entry` y `exit`") se recrea para exceptuar también a `sale`; las filas
existentes lo cumplen, así que no hay riesgo de pérdida (se valida antes de
aplicarlo).

**Para el frontend:** al regenerar `src/types/database.ts` el enum de la base trae `sale`, y
`src/types/contract-check.ts` falla hasta que `MovementType` (`src/domain/movements.ts`) lo
incluya. Es un cambio de `efacelli`; el backend no toca `src/` salvo el archivo generado.

`register_product_movement` y `register_stock_movement` **rechazan `sale`**
(`INVALID_MOVEMENT_TYPE`): ese tipo solo lo escribe `register_sale`. Del mismo
modo, `reverse_stock_movement` rechaza revertir un movimiento `sale`
(`INVALID_MOVEMENT_TYPE`): una venta se deshace únicamente con `void_sale`.
Sin estas dos reglas habría un segundo camino para tocar el stock de una venta.

### 15.3 Tablas

Todas con RLS, `security_invoker` en las vistas, `INSERT`/`UPDATE`/`DELETE`
directo revocado a `authenticated` (se escribe por RPC), salvo la edición de
catálogos de la tabla indicada.

#### 15.3.1 `payment_methods`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `code` | `text` | no | — | `UNIQUE` (`payment_methods_code_key`). `CHECK (code ~ '^[a-z_]{2,20}$')`. Identificador estable que usa el código |
| `name` | `text` | no | — | Nombre visible (español), 1–40 caracteres |
| `is_cash` | `boolean` | no | `false` | Solo el efectivo admite vuelto y entra en el arqueo. Índice único parcial `payment_methods_one_cash_key` `WHERE is_cash` (un solo medio es efectivo) |
| `is_active` | `boolean` | no | `true` | Un medio inactivo no se puede usar en ventas nuevas |
| `sort_order` | `integer` | no | `0` | Orden en pantalla |
| columnas comunes | | | | §2.5 |

La migración crea 5 filas (respuesta 39): `cash` "Efectivo" (`is_cash`),
`debit` "Débito", `credit` "Crédito", `qr` "QR", `transfer` "Transferencia".
No se borran; se desactivan. Editan nombre, orden y `is_active` el encargado y
el dueño. Agregar un medio nuevo es una fila, sin migración de esquema.

#### 15.3.2 `cash_registers` (cajas físicas)

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `name` | `text` | no | — | 1–40 caracteres; único sin distinguir tildes ni mayúsculas (`cash_registers_name_key`, igual que §5.2) |
| `is_active` | `boolean` | no | `true` | — |
| columnas comunes | | | | §2.5 |

La migración crea "Caja 1" y "Caja 2" (respuesta 38). Las altas y ediciones las
hacen el encargado y el dueño (una caja nueva es una fila). No se borran.

#### 15.3.3 `cash_sessions` (turno de una caja: apertura, ventas y cierre)

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `idempotency_key` | `uuid` | no | — | `UNIQUE`. Clave de la apertura (reintento seguro) |
| `cash_register_id` | `uuid` | no | — | FK → `cash_registers.id` (`RESTRICT`) |
| `status` | `cash_session_status` | no | `'open'` | — |
| `opened_at` | `timestamptz` | no | `now()` | No lo fija el cliente |
| `opened_by` | `uuid` | no | `auth.uid()` | FK → `profiles.id` |
| `opening_amount` | `numeric(12,2)` | no | — | `CHECK (opening_amount >= 0)`. Efectivo inicial (cambio) |
| `closed_at` | `timestamptz` | sí | — | — |
| `closed_by` | `uuid` | sí | — | FK → `profiles.id` |
| `expected_cash` | `numeric(12,2)` | sí | — | Se calcula y guarda al cerrar (§15.5) |
| `counted_cash` | `numeric(12,2)` | sí | — | `CHECK (counted_cash >= 0)`. Efectivo contado por la persona |
| `difference` | `numeric(12,2)` | sí | — | `counted_cash − expected_cash` (negativo = faltante). Lo guarda `close_cash_session` |
| `close_notes` | `text` | sí | — | — |
| `created_at` | `timestamptz` | no | `now()` | — |

- **Una sola sesión abierta por caja:** índice único parcial
  `cash_sessions_one_open_per_register_key` sobre `(cash_register_id)`
  `WHERE status = 'open'`. Dos cajas distintas pueden estar abiertas a la vez.
- `CHECK` de coherencia: `status = 'open'` ⇒ los campos de cierre son `NULL`;
  `status = 'closed'` ⇒ `closed_at`, `closed_by`, `counted_cash`,
  `expected_cash` y `difference` están completos.
- Una sesión cerrada **no se reabre ni se edita**. Las correcciones se
  documentan en una sesión nueva (P-31).
- Índices: `(cash_register_id, opened_at desc)`, `(opened_by)`.

#### 15.3.4 `sales`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `sale_number` | `bigint` | no | identity | `UNIQUE` (`sales_sale_number_key`). Número visible del comprobante interno. **Único, no correlativo** (una transacción revertida deja un hueco, igual que el SKU, §8.9). **No es el número fiscal** (§15.8) |
| `idempotency_key` | `uuid` | no | — | `UNIQUE` (`sales_idempotency_key_key`). La genera el cliente al abrir el carrito y la conserva en los reintentos |
| `request_hash` | `text` | no | — | `md5` de la solicitud normalizada (§15.6). Solo lo escribe la RPC; sirve para detectar `IDEMPOTENCY_CONFLICT` |
| `cash_session_id` | `uuid` | no | — | FK → `cash_sessions.id` (`RESTRICT`) |
| `status` | `sale_status` | no | `'completed'` | — |
| `total_amount` | `numeric(12,2)` | no | — | `CHECK (total_amount > 0)`. Suma de `sale_items.line_total` |
| `net_amount` | `numeric(12,2)` | no | — | Suma de netos de los ítems (sin IVA) |
| `vat_amount` | `numeric(12,2)` | no | — | Suma del IVA de los ítems. `CHECK (net_amount + vat_amount = total_amount)` |
| `rounding_amount` | `numeric(12,2)` | no | `0` | v0.6.3 (P-30). `Σ amount de los pagos − total_amount`: lo que el redondeo agregó (+) o descontó (−) al total. La caja sugiere el total redondeado y el cajero puede cambiarlo; la base no exige un valor, solo el límite `CHECK (abs(rounding_amount) < rounding_multiple)`. **No cambia** `total_amount` ni los ítems |
| `rounding_multiple` | `numeric(12,2)` | no | — | Múltiplo de `sales_settings` vigente al vender (copia). `CHECK (rounding_multiple > 0)`. Deja el límite del redondeo verificable en la propia fila aunque después cambie la configuración |
| `notes` | `text` | sí | — | — |
| `created_at` | `timestamptz` | no | `now()` | Momento de la venta; no lo fija el cliente |
| `created_by` | `uuid` | no | `auth.uid()` | FK → `profiles.id`. Quién vendió |
| `voided_at` | `timestamptz` | sí | — | — |
| `voided_by` | `uuid` | sí | — | FK → `profiles.id` |
| `void_reason` | `text` | sí | — | Obligatorio al anular. `CHECK`: `status = 'voided'` ⇔ los tres campos de anulación están completos |

Un trigger rechaza `DELETE` y cualquier `UPDATE` que cambie algo distinto de
`status`, `voided_at`, `voided_by` y `void_reason`, y que no sea el paso
`completed → voided`. Índices: `(cash_session_id)`, `(created_at desc)`,
`(created_by)`.

#### 15.3.5 `sale_items`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `sale_id` | `uuid` | no | — | FK → `sales.id` (`RESTRICT`) |
| `product_id` | `uuid` | no | — | FK → `products.id` (`RESTRICT`). `UNIQUE (sale_id, product_id)`: un ítem por producto (la RPC suma las líneas repetidas) |
| `quantity` | `numeric(12,3)` | no | — | `CHECK (quantity > 0)`. En unidades de venta del producto (§4.2) |
| `unit_price_with_vat` | `numeric(12,2)` | no | — | Copia de `products.sale_price_with_vat` al vender |
| `vat_rate` | `numeric(4,2)` | no | — | Copia de `products.vat_rate` |
| `line_total` | `numeric(12,2)` | no | — | `round(quantity * unit_price_with_vat, 2)`. `CHECK (line_total > 0)` |
| `net_amount` | `numeric(12,2)` | no | — | `round(line_total / (1 + vat_rate / 100), 2)` |
| `vat_amount` | `numeric(12,2)` | no | — | `line_total − net_amount`. `CHECK (net_amount + vat_amount = line_total)` |
| `unit_cost_price` | `numeric(12,2)` | no | — | Copia de `products.cost_price` (sin IVA), para el margen real |
| `product_sku` | `text` | no | — | Copia del SKU, para tickets e historial |
| `product_name` | `text` | no | — | Copia del nombre |

Inmutable (mismo trigger que `sales`). Índice `(product_id)`. El IVA se discrimina
por ítem porque el negocio es Responsable Inscripto (P-02) y una factura A lo
necesitará; el redondeo definitivo del comprobante fiscal se revisa en la
etapa 6.

#### 15.3.6 `sale_payments`

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `sale_id` | `uuid` | no | — | FK → `sales.id` (`RESTRICT`) |
| `payment_method_id` | `uuid` | no | — | FK → `payment_methods.id` (`RESTRICT`) |
| `amount` | `numeric(12,2)` | no | — | `CHECK (amount > 0)`. Lo que **se aplica a la venta** |
| `tendered_amount` | `numeric(12,2)` | sí | — | Solo efectivo: lo que entregó el cliente. `CHECK (tendered_amount IS NULL OR tendered_amount >= amount)`. Vuelto = `tendered_amount − amount` |
| `reference` | `text` | sí | — | Referencia opcional (últimos dígitos, n.º de operación). **Nunca el número de tarjeta completo ni datos sensibles** |

Inmutable. `UNIQUE (sale_id, payment_method_id)`. **Invariante (v0.6.3):** la
suma de `amount` de una venta es igual a `sales.total_amount + sales.rounding_amount`
(lo valida la RPC y un *constraint trigger* diferido, como el del ledger, §3).
El `amount` del efectivo es lo que **entra de verdad en la caja**. Solo el efectivo
puede tener `tendered_amount` (lo valida la RPC por `payment_methods.is_cash`).

#### 15.3.8 `sales_settings` (v0.6.1)

Configuración de ventas: **una sola fila**, igual que la fila general de alertas
(§5.9). Hoy guarda solo el múltiplo del redondeo del total de la venta (P-30).

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `rounding_multiple` | `numeric(12,2)` | no | `100` | `CHECK (rounding_multiple > 0)`. Múltiplo del redondeo del total (centena más cercana; desde la mitad sube; menos de la mitad se cobra exacto) |
| columnas comunes | | | | §2.5 |

- Fila única: índice `sales_settings_singleton_key` sobre `((true))`. La migración
  la crea con `100`; no se borra.
- La lee cualquier usuario activo (el frontend la usa para mostrar el redondeo);
  la edita el encargado o el dueño. Los cambios quedan en `audit_log`.
- El cambio rige para las ventas **nuevas**: cada venta guarda su `rounding_amount`
  y el múltiplo con que se vendió (`rounding_multiple`), así que las anteriores no se modifican.

### 15.4 Relaciones

```
cash_registers 1──N cash_sessions 1──N sales 1──N sale_items 1──N stock_movements (movement_type = 'sale')
                                          │              └── N──1 products
                                          └──N sale_payments N──1 payment_methods
```

### 15.5 Vistas (lectura)

Ambas `security_invoker`, con las mismas políticas de lectura de §15.7.

**`v_cash_session_summary`** — una fila por sesión (para la pantalla de caja y
el arqueo):

| Columna | Tipo | Notas |
|---|---|---|
| `cash_session_id` | `uuid` | — |
| `cash_register_id`, `cash_register_name` | `uuid`, `text` | — |
| `status`, `opened_at`, `opened_by`, `closed_at`, `closed_by` | | De `cash_sessions` |
| `opening_amount` | `numeric(12,2)` | — |
| `sales_count` | `integer` | Ventas `completed` de la sesión |
| `sales_total` | `numeric(12,2)` | Suma de `total_amount` de las `completed` |
| `voided_count` | `integer` | Ventas anuladas |
| `cash_collected` | `numeric(12,2)` | Suma de `amount` de pagos en efectivo de ventas `completed` (ya con el redondeo: lo que entró de verdad en la caja) |
| `rounding_total` | `numeric(12,2)` | Suma de `rounding_amount` de las ventas `completed` (v0.6.3, todos los medios de pago). Explica la diferencia entre el valor de las ventas y lo cobrado |
| `expected_cash` | `numeric(12,2)` | Abierta: `opening_amount + cash_collected` calculado en vivo. Cerrada: el valor guardado |
| `counted_cash`, `difference` | `numeric(12,2)` | Solo cerrada |

**`v_cash_session_payments`** — una fila por sesión y medio de pago:
`cash_session_id`, `payment_method_id`, `payment_method_code`,
`payment_method_name`, `payments_count`, `amount_total` (solo ventas
`completed`). Sirve para conciliar contra el posnet, el QR y la cuenta bancaria.

Fórmula del arqueo (v0.6.0): `expected_cash = opening_amount + Σ amount` de los
pagos en efectivo de ventas `completed` de la sesión. Como solo se anula con la
sesión abierta (§15.6), una venta anulada nunca figura en una sesión cerrada.
Retiros y aportes de efectivo no existen todavía (P-31). El redondeo ya está
incluido porque se suma el `amount` del efectivo, no el valor de los ítems.

Para el empleado, `sales_count`, `sales_total` y `voided_count` cuentan **solo sus ventas** (la
RLS de `sales` es por vendedor, P-34); el encargado y el dueño ven los totales de la sesión.
Una sesión **cerrada** que abrió el propio empleado le muestra `expected_cash`, `counted_cash` y
`difference`; `cash_collected` y `rounding_total` son solo del encargado y el dueño.

**Arqueo a ciegas (P-40):** para el empleado, mientras la sesión está abierta,
`expected_cash`, `cash_collected`, `rounding_total`, `counted_cash` y
`difference` vienen `NULL`; el encargado y el dueño ven todo. Al cerrar, la RPC
devuelve la diferencia a quien cerró (§15.6).

### 15.6 Funciones RPC

Mismas reglas generales de §8: `SECURITY DEFINER`, `search_path = ''`,
validan rol y `is_active`, una transacción por llamada, `EXECUTE` solo a
`authenticated`. Errores con `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<CODIGO>'` (§8.6).

#### `open_cash_session`

```
open_cash_session(
  p_idempotency_key uuid,
  p_cash_register_id uuid,
  p_opening_amount  numeric
) returns cash_sessions
```

Crea la sesión `open`. Si la caja ya tiene una abierta →
`CASH_SESSION_ALREADY_OPEN`, salvo que sea el mismo reintento (misma clave):
devuelve la existente. `p_opening_amount` < 0 → `INVALID_AMOUNT`.
Caja inexistente o inactiva → `CASH_REGISTER_NOT_FOUND`. Cualquier usuario activo.

#### `close_cash_session`

```
close_cash_session(
  p_cash_session_id uuid,
  p_counted_cash    numeric,
  p_close_notes     text default null
) returns cash_sessions
```

Bloquea la sesión con `FOR UPDATE`, calcula `expected_cash` y `difference`,
guarda el cierre y pasa a `closed`. Ya cerrada → `CASH_SESSION_CLOSED` (no se
cierra dos veces). `p_counted_cash` < 0 → `INVALID_AMOUNT`. La cierra quien la
abrió, el encargado o el dueño. Como `register_sale` toma la sesión con
`FOR SHARE`, **ninguna venta puede colarse mientras se cierra**: o entra antes y
cuenta en el arqueo, o llega después y recibe `CASH_SESSION_CLOSED`.

#### `register_sale`

```
register_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_items           jsonb,   -- [{ "product_id": uuid, "quantity": number }, ...]
  p_payments        jsonb,   -- [{ "payment_method_id": uuid, "amount": number,
                             --    "tendered_amount": number|null, "reference": text|null }, ...]
  p_notes           text default null
) returns sales
```

En una transacción, en este orden:

1. **Permisos y sesión.** Usuario activo; la sesión existe y está `open`
   (`CASH_SESSION_NOT_FOUND` / `CASH_SESSION_CLOSED`).
2. **Idempotencia** (§8.5): bloqueo consultivo sobre la clave. Si ya existe una
   venta con esa clave y el mismo `request_hash`, **se devuelve esa venta sin
   crear nada** (incluso si la sesión se cerró entre el intento y el reintento);
   con otro hash → `IDEMPOTENCY_CONFLICT`. El hash se calcula sobre la solicitud
   normalizada: sesión, ítems agrupados por producto con cantidad sumada y
   ordenados por `product_id`, y pagos ordenados por medio (con `amount` y
   `tendered_amount`). No entran `notes` ni `reference`.
3. **Validación de la solicitud.** Sin ítems → `EMPTY_SALE`. Cantidad ≤ 0 o con
   decimales en una unidad de cantidades enteras → `INVALID_QUANTITY` (misma
   regla que §8.1). Producto inexistente → `PRODUCT_NOT_FOUND`; inactivo →
   `PRODUCT_INACTIVE`. Las líneas con el mismo producto se suman.
4. **Precios.** Por cada producto toma `sale_price_with_vat`, `vat_rate`,
   `cost_price`, `sku` y `name` **en ese instante** y calcula `line_total`,
   `net_amount` y `vat_amount` (§15.3.5). El cliente no envía precios.
5. **Descuento FEFO por ítem.** Procesa los productos en orden de `id` (orden
   fijo para evitar bloqueos cruzados entre ventas simultáneas) y, para cada
   uno, recorre los lotes igual que §8.7: `expires_on`, `received_on`, `id`,
   `FOR UPDATE`, **salteando lotes vencidos** (P-15: lo vencido no se vende).
   Crea un movimiento `sale` por lote usado, con `sale_item_id`,
   `operation_key = sales.id` y su propio `idempotency_key` generado por la
   base. Si el stock vendible no alcanza → `INSUFFICIENT_STOCK` (con el
   producto en `DETAIL`) y **no se registra nada** (P-36).
6. **Pagos y redondeo del total (P-30).** La caja **sugiere** el total redondeado
   (`round_cash`, abajo) y el cajero puede cambiar el monto a cobrar. La base **no
   exige** el valor sugerido; solo valida (la RPC no recibe parámetros nuevos):
   1. Cada medio debe existir y estar activo (`PAYMENT_METHOD_INVALID`), cada
      `amount` ser > 0 y no repetirse el medio (`INVALID_PAYMENT`).
   2. `tendered_amount` solo en efectivo y ≥ `amount` (`INVALID_PAYMENT`); el
      vuelto es `tendered_amount − amount`.
   3. `rounding_amount = Σ amount − total_amount` tiene que cumplir
      `abs(rounding_amount) < sales_settings.rounding_multiple`; si no, →
      `PAYMENT_MISMATCH`. Rige para **cualquier medio** de pago (efectivo,
      débito, crédito, QR o transferencia, solos o combinados).
   4. Se guarda `sales.rounding_amount` y `sales.rounding_multiple` (el vigente).
      Invariante: `Σ amount = total_amount + rounding_amount`.

   **Monto sugerido:** `private.round_cash(x, m)` = `x` si `x < m / 2` (se cobra
   exacto, P-39); si no, `floor(x / m + 0.5) * m` en `numeric` exacto: **múltiplo
   más cercano, y desde la mitad sube**. Con `m = 100`: 1.237 → 1.200; 1.249 →
   1.200; 1.250 → 1.300; 1.280 → 1.300; 1.200 → 1.200; 49,99 → 49,99; 30 → 30.
   El frontend aplica la misma regla; las pruebas de la base la fijan para que no
   diverjan. Con un solo medio, ese medio paga todo el monto a cobrar; si se
   combinan, el efectivo cubre lo que falta (eso lo arma el frontend).
7. **Guarda** `sales`, `sale_items` y `sale_payments` y devuelve la fila de
   `sales`. El frontend lee ítems y pagos con un `select` embebido.

Permisos (§15.7): cualquier usuario activo. Todo con `private.raise_business_error`.

**Importes (todas las RPC de caja y ventas):** hasta 2 decimales. El servidor tolera el ruido
de coma flotante del cliente (por ejemplo `0.30000000000000004` se toma como `0.30`) y
rechaza lo que tenga decimales reales de más (`INVALID_AMOUNT` o `INVALID_PAYMENT`).

#### `void_sale`

```
void_sale(
  p_idempotency_key uuid,
  p_sale_id         uuid,
  p_reason          text
) returns sales
```

Solo encargado y dueño. Motivo obligatorio (`REASON_REQUIRED`). Venta inexistente
→ `SALE_NOT_FOUND`; ya anulada → `ALREADY_VOIDED` (un reintento con la misma
clave devuelve la venta ya anulada). Solo se puede anular **mientras la sesión de
caja de la venta siga abierta**; si ya se cerró → `CASH_SESSION_CLOSED` (la
devolución posterior al cierre es de otra etapa, P-32).

**Idempotencia:** la clave queda en `operation_key` de los movimientos compensatorios. Reintentar con
la misma clave devuelve la venta ya anulada; anular una venta ya anulada con otra clave →
`ALREADY_VOIDED`.

Por cada movimiento `sale` de la venta crea un movimiento compensatorio
`adjustment_in` al **mismo lote**, con `reverses_movement_id` (así sigue valiendo
"un movimiento se revierte una sola vez", §5.7), `operation_key = p_idempotency_key`
y el motivo. Después marca la venta `voided`. La anulación puede repetir un lote
vencido o un producto inactivo (igual que §8.3: corregir tiene que ser posible).

### 15.7 Seguridad

| Objeto | Empleado (`staff`) | Encargado / dueño | Usuario inactivo |
|---|---|---|---|
| `payment_methods`, `cash_registers` | lee | lee / crea / edita | — |
| `sales_settings` | lee | edita | — |
| `cash_sessions` | lee **las abiertas** (para elegir caja, P-33) y las que abrió | lee todas | — |
| `sales`, `sale_items`, `sale_payments` | lee las que vendió | lee todas | — |
| `open_cash_session`, `register_sale` | sí | sí | `NOT_AUTHORIZED` |
| `close_cash_session` | solo la que abrió | cualquiera | `NOT_AUTHORIZED` |
| `void_sale` | no (`NOT_AUTHORIZED`) | sí | `NOT_AUTHORIZED` |
| `v_cash_session_summary` | las abiertas y las suyas, **sin** `expected_cash`, `cash_collected`, `rounding_total`, `counted_cash` ni `difference` mientras están abiertas (P-40) | todas, con todo | sin filas |
| `v_cash_session_payments` | las de sus propias sesiones | todas | sin filas |

- `anon`: sin acceso a ninguna tabla, vista ni función nueva. Se agregan a la
  matriz de `14_security_matrix.test.sql` (§12).
- `authenticated` no recibe `INSERT`/`UPDATE`/`DELETE` directo sobre
  `cash_sessions`, `sales`, `sale_items`, `sale_payments` ni sobre las columnas
  nuevas de `stock_movements`. Los catálogos (`payment_methods`, `cash_registers`)
  los edita el encargado con permisos por columna, como los de §5.2.
- Los catálogos y `sales_settings` entran en `audit_log` (§5.8). Las ventas ya son su
  propio registro inmutable (`created_by`, `voided_by`).
- Las ventas **no guardan** datos de tarjetas, tokens ni credenciales de
  billeteras; `reference` es texto libre acotado y la UI lo rotula así.

### 15.8 Relación con ARCA y con el modo offline (sin implementar)

- **ARCA.** `sales` no lleva campos fiscales. La etapa 6 agrega una tabla aparte
  (`fiscal_documents`: venta, tipo de comprobante, punto de venta, número, CAE,
  vencimiento del CAE, estado, solicitud y respuesta) con una única fila válida
  por venta. Una venta nunca se considera factura hasta tener respuesta
  afirmativa de ARCA. No se decide nada fiscal acá (P-27).
- **Offline.** La `idempotency_key` de `register_sale` ya permite reintentos
  seguros desde una cola local. Para el offline harán falta una fecha de venta
  elegida por el cliente (hoy el momento es `now()` de la base) y reglas de
  conflicto de stock; no se anticipan ahora (CLAUDE.md: nunca *last-write-wins*
  para stock).

### 15.9 Códigos de error nuevos y preguntas abiertas

Se suman a §8.6:

| Código | Cuándo |
|---|---|
| `CASH_REGISTER_NOT_FOUND` | Caja inexistente o inactiva |
| `CASH_SESSION_NOT_FOUND` | Sesión inexistente o no visible |
| `CASH_SESSION_ALREADY_OPEN` | La caja ya tiene una sesión abierta |
| `CASH_SESSION_CLOSED` | Vender, cerrar de nuevo o anular en una sesión ya cerrada |
| `EMPTY_SALE` | Venta sin ítems |
| `PAYMENT_METHOD_INVALID` | Medio de pago inexistente o inactivo |
| `PAYMENT_MISMATCH` | La diferencia entre lo cobrado y el total llega a un múltiplo del redondeo (`abs(Σ amount − total) >= rounding_multiple`, §15.6 paso 6), o no hay pagos |
| `INVALID_PAYMENT` | Importe de pago ≤ 0, o entregado menor al importe, o entregado en un medio que no es efectivo |
| `INVALID_AMOUNT` | Monto de apertura o conteo negativo o con más de 2 decimales |
| `PRODUCT_PRICE_INVALID` | El producto tiene precio 0: no se puede vender |
| `SALE_NOT_FOUND` | Venta inexistente o no visible |
| `ALREADY_VOIDED` | La venta ya está anulada |

Reutiliza: `NOT_AUTHORIZED`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`,
`INVALID_QUANTITY`, `INSUFFICIENT_STOCK`, `REASON_REQUIRED`,
`IDEMPOTENCY_CONFLICT`, `INVALID_MOVEMENT_TYPE`.

**Preguntas** (P-27 a P-40: decisiones de `efacelli`, en el PR de esta
propuesta; todas resueltas):

| # | Pregunta | Decisión | Estado |
|---|---|---|---|
| P-27 | ¿Se emite factura ARCA en cada venta? | La caja emite un **ticket interno no fiscal** que dice "NO VÁLIDO COMO FACTURA"; el súper sigue facturando con su sistema actual. La factura electrónica desde Zahuy se diseña en la etapa 6 con el contador | Adoptada |
| P-28 | Descuentos por cantidad (cada 6 = 5 %, 12 = 10 %, 18 = 15 %) | Fuera de v0.6.x. Se agregarán columnas de descuento por ítem y una tabla de reglas; el empleado podrá quitarlo. Hay que definir a qué productos aplica | Adoptada |
| P-29 | Cuenta corriente y clientes | Fuera de v0.6.x. Se reserva un medio de pago `account` y `sales.customer_id` nulable para esa etapa | Adoptada |
| P-30 | Redondeo del total | **Cambió el 2026-11-16.** Se redondea **el total de la venta con cualquier medio de pago** a la centena más cercana (desde la mitad sube: 1.237 → 1.200, 1.250 → 1.300); con menos de $50 se cobra exacto. El monto redondeado es una **sugerencia**: el cajero puede cambiarlo, por ejemplo para volver al total exacto. La base no exige el valor sugerido, solo el límite `abs(rounding_amount) < rounding_multiple` (`PAYMENT_MISMATCH`). Columnas: `sales.rounding_amount` (= Σ pagos − total, ± ) y `sales.rounding_multiple`; configuración `sales_settings.rounding_multiple` (§15.3.8). El arqueo suma lo que entró de verdad en efectivo | Adoptada |
| P-31 | Retiros y aportes de efectivo durante el turno; arqueo que no cierra | Sin retiros en v0.6.x; la diferencia se guarda y el encargado la ve. Una sesión cerrada no se reabre | Adoptada |
| P-32 | ¿Se puede anular una venta de un turno ya cerrado? | No: solo con la sesión abierta. Después, devolución (etapa posterior) | Adoptada |
| P-33 | ¿Una caja la usa una sola persona por turno o se comparte? | Cualquier usuario activo vende en cualquier sesión abierta; cada venta registra quién vendió | Adoptada |
| P-34 | ¿El empleado ve las ventas de otros? | No: solo las propias (§15.7). El encargado ve todas | Adoptada |
| P-35 | Pesables con etiqueta de balanza | La venta recibe la cantidad en kg; leer la etiqueta es del frontend. Falta definir el campo de código de balanza por producto (§11) | Adoptada |
| P-36 | Vender producto sin stock registrado | Se mantiene **sin stock negativo** (`INSUFFICIENT_STOCK`). Antes de usar la caja, el súper carga el stock real (inventario inicial con el lector). No hay excepción | Adoptada |
| P-37 | Tickets e impresión | Del frontend; el contrato aporta `sale_number`, ítems, pagos y vuelto | Adoptada |
| P-38 | ¿Se vende de lotes vencidos? | No: los lotes vencidos no se venden (P-15) | Adoptada |
| P-39 | Una compra de menos de la mitad del múltiplo (menos de $50) | **Decidida (efacelli):** se cobra exacta, sin redondear ($30 → $30, $49,99 → $49,99). Desde $50 rige la centena más cercana. Desaparece `CASH_AMOUNT_TOO_SMALL` | Adoptada |
| P-40 | Arqueo a ciegas: el frontend no muestra lo esperado al cerrar, pero con la API el empleado podría consultarlo | La base no se lo entrega al empleado mientras la sesión está abierta (§15.5, §15.7), aunque sí le permite ver las sesiones abiertas para vender (P-33). El encargado y el dueño ven todo. `efacelli` de acuerdo; el frontend trata `NULL` como "sin dato" | Adoptada |

### 15.10 Pruebas que se exigirán al implementar (se suman a §12)

- Venta feliz: total, neto e IVA suman; precio del ítem = `sale_price_with_vat`;
  luego de cambiar el precio del producto, la venta vieja no cambia.
- FEFO en venta: con lotes A (4 u., vence antes) y B (20 u.), vender 10 genera
  `sale` de 4 sobre A y 6 sobre B; vender 30 → `INSUFFICIENT_STOCK` y no queda
  venta, pagos ni movimientos; un lote vencido se saltea.
- Cantidad 0, negativa y con decimales en producto `unit` → `INVALID_QUANTITY`;
  `kg` con 3 decimales → permitido. Producto inactivo → `PRODUCT_INACTIVE`.
- Líneas repetidas del mismo producto se suman en un solo ítem.
- Pagos: suma distinta del total → `PAYMENT_MISMATCH`; efectivo con vuelto;
  `tendered_amount` en tarjeta → `INVALID_PAYMENT`; medio inactivo →
  `PAYMENT_METHOD_INVALID`; pago mixto efectivo + QR.
- Redondeo del total (P-30), con múltiplo 100: la base **acepta** cobrar el sugerido
  (1.237 → 1.200, `rounding_amount` −37; 1.250 → 1.300, +50; 49,99 → 49,99, 0) y
  cualquier otro monto cuya diferencia con el total sea menor que 100 (el cajero
  puede volver al total exacto); rechaza con `PAYMENT_MISMATCH` una diferencia de
  100 o más, hacia arriba o hacia abajo, con cualquier medio de pago; el límite
  también está en la fila (`CHECK`). `round_cash` devuelve lo mismo que el
  frontend. Cambiar `rounding_multiple` cambia el límite de las ventas nuevas y no
  modifica las anteriores (cada venta guarda el suyo). Invariante
  `Σ amount = total_amount + rounding_amount` en toda venta; el arqueo suma el
  `amount` del efectivo.
- Arqueo a ciegas (P-40): el empleado ve las sesiones abiertas pero
  `expected_cash` y compañía vienen `NULL`; el encargado los ve; al cerrar, el
  cálculo no depende de lo que vea quien cierra.
- Idempotencia: misma clave y misma solicitud dos veces → una sola venta y un
  solo descuento de stock; misma clave con otros ítems → `IDEMPOTENCY_CONFLICT`;
  reintento después del cierre de la caja → devuelve la venta original.
- Concurrencia: varias ventas simultáneas sobre el mismo lote nunca dejan saldo
  negativo; el mismo reintento en paralelo crea una sola venta; una venta y el
  cierre de caja a la vez dan un arqueo consistente.
- Una venta nunca descuenta dos veces: el índice
  `stock_movements_sale_item_batch_key` rechaza el segundo movimiento `sale`
  del mismo ítem y lote.
- `register_product_movement`, `register_stock_movement` y
  `reverse_stock_movement` rechazan `sale` / movimientos `sale`
  (`INVALID_MOVEMENT_TYPE`).
- Anulación: devuelve stock a los mismos lotes, solo encargado/dueño,
  `ALREADY_VOIDED` a la segunda, `CASH_SESSION_CLOSED` con la sesión cerrada,
  conciliación del ledger intacta.
- Caja: dos cajas abiertas a la vez; segunda apertura de la misma →
  `CASH_SESSION_ALREADY_OPEN`; arqueo = apertura + efectivo cobrado; diferencia
  guardada; cierre doble → `CASH_SESSION_CLOSED`; vender en caja cerrada → error.
- Inmutabilidad: `UPDATE`/`DELETE` sobre `sales`, `sale_items`, `sale_payments`
  y sesiones cerradas → rechazado.
- RLS: cada fila de §15.7 con un usuario permitido y uno denegado; `anon` sin
  acceso; el empleado no ve ventas ajenas; ningún `INSERT` directo.
- Migraciones sobre una base con datos previos (productos, lotes y movimientos
  de prueba): los conteos, las huellas de datos y el stock se conservan; la
  matriz de seguridad incluye las tablas nuevas.

### 15.11 Plan de migraciones (cuando se apruebe)

Todas aditivas y sin borrar nada, en este orden: (1) `ALTER TYPE movement_type
ADD VALUE 'sale'` (sola); (2) enums y tablas de catálogos, caja y `sales_settings` con sus filas
iniciales (los 5 medios de pago, Caja 1 y 2, múltiplo 100) y, en el mismo PR,
agregar `payment_methods`, `cash_registers` y `sales_settings` a `v_seeded` de
`supabase/scripts/restore-prepare.sql` (si no, el paso previo de restauración se
detiene y avisa); (3) `sales`, `sale_items`, `sale_payments` y la columna
`stock_movements.sale_item_id` con sus índices, más el recreado del `CHECK` de
`reason`; (4) vistas y RPC; (5) cambios a `register_product_movement`,
`register_stock_movement` y `reverse_stock_movement` para rechazar `sale`;
(6) pruebas pgTAP, concurrencia y matriz de seguridad. Cada paso con
`db reset`, pgTAP y la prueba sobre datos previos; antes de aplicarlas en un
proyecto real, backup verificado (`docs/DEPLOY.md` §7).

## 16. Descuentos por cantidad y métricas de ventas (PROPUESTA v0.7.0)

> **Propuesta.** P-41 y P-42 decididas; falta P-43 (la define `ChinoNader18`) y que el
> backend la acepte. Reemplaza lo que P-28 dejaba "fuera de v0.6.x".

### 16.1 Regla de negocio (decisión de `efacelli`, 2026-11-16)

- **Cada 6 unidades del mismo producto, 5 % de descuento sobre esa línea**, y así
  sucesivamente: 6 → 5 %, 12 → 10 %, 18 → 15 %, … Fórmula sugerida:
  `floor(quantity / step) * percent` con `step = 6` y `percent = 5`.
- Aplica a **todos los productos** (no hay lista de excluidos).
- Es una **sugerencia**: quien está en la caja (cualquier usuario activo, también el
  empleado) puede **cambiar el porcentaje de cada línea o quitarlo**, igual que el
  redondeo (P-30): puede **bajarlo, quitarlo o subirlo**, siempre hasta el tope de **30 %** (P-41, P-42). La base guarda lo sugerido y lo aplicado.
- El descuento se aplica **antes** del redondeo del total: se redondea lo que queda
  después de descontar.

### 16.2 Cambios de esquema (aditivos)

`sales_settings` (§15.3.8), columnas nuevas con default (la fila existente queda
con los valores de la decisión):

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| `quantity_discount_step` | `integer` | no | `6` | `CHECK (> 0)`. Cada cuántas unidades sube el descuento |
| `quantity_discount_percent` | `numeric(5,2)` | no | `5` | `CHECK (>= 0 AND <= 100)`. Cuánto sube por cada escalón |
| `quantity_discount_max_percent` | `numeric(5,2)` | no | `30` | `CHECK (>= 0 AND <= 100)`. Tope del descuento por línea: limita el sugerido y lo que escribe el cajero (P-41) |

`sale_items` (§15.3.5), columnas nuevas. Las filas ya existentes quedan con
`list_line_total = line_total` y descuentos en 0 (backfill en la misma migración):

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| `list_line_total` | `numeric(12,2)` | no | — | `round(quantity * unit_price_with_vat, 2)`: la línea sin descuento |
| `suggested_discount_percent` | `numeric(5,2)` | no | `0` | Lo que sugirió la regla al vender (para auditar ediciones) |
| `discount_percent` | `numeric(5,2)` | no | `0` | `CHECK (>= 0 AND <= 100)`. Lo aplicado |
| `discount_amount` | `numeric(12,2)` | no | `0` | `round(list_line_total * discount_percent / 100, 2)`. `CHECK (discount_amount >= 0 AND discount_amount < list_line_total)` |

`line_total` **mantiene su significado** (lo que se cobra por la línea) y pasa a ser
`list_line_total − discount_amount`; `net_amount` y `vat_amount` se calculan sobre
ese `line_total`. Así siguen valiendo `sales.total_amount = Σ line_total` y
`Σ pagos = total_amount + rounding_amount` sin cambios.

`sales`: `discount_total numeric(12,2) not null default 0` = `Σ discount_amount`
(las ventas existentes quedan en 0).

### 16.3 `register_sale` (cambio compatible)

Cada elemento de `p_items` admite un campo opcional:
`{ "product_id": uuid, "quantity": number, "discount_percent": number|null }`.

- Sin `discount_percent` (o `null`) → se aplica el **sugerido**. Las llamadas
  actuales del frontend siguen funcionando.
- Con valor → se aplica ese, si está entre 0 y `quantity_discount_max_percent`
  con hasta 2 decimales; si no → `INVALID_DISCOUNT` (código nuevo).
- Las líneas repetidas del mismo producto se suman antes de calcular el sugerido; si
  traen porcentajes distintos → `INVALID_DISCOUNT`.
- El `discount_percent` entra en el `request_hash` (idempotencia, §15.6 paso 2).
- `private.suggested_discount(quantity, step, percent, max)` =
  `least(floor(quantity / step) * percent, max)`. El frontend aplica la misma
  regla; las pruebas de la base la fijan.

### 16.4 Vista `v_sales_daily` (métricas de finanzas del dashboard)

Una fila por día (fecha local `America/Argentina/Buenos_Aires`), solo encargado y
dueño (el empleado no ve filas). `security_invoker`. Cuenta solo ventas `completed`.

| Columna | Tipo | Notas |
|---|---|---|
| `sale_date` | `date` | — |
| `sales_count` | `integer` | — |
| `voided_count` | `integer` | Anuladas ese día |
| `total_amount` | `numeric(12,2)` | Σ `total_amount` |
| `net_amount`, `vat_amount` | `numeric(12,2)` | Σ de las ventas |
| `discount_total` | `numeric(12,2)` | Σ `discount_total` (0 hasta implementar §16.2) |
| `rounding_total` | `numeric(12,2)` | Σ `rounding_amount` |
| `cost_total` | `numeric(12,2)` | Σ `round(quantity * unit_cost_price, 2)` de los ítems (costo sin IVA) |
| `gross_margin` | `numeric(12,2)` | `net_amount − cost_total` |

Y `v_sales_daily_payments`: `sale_date`, `payment_method_id`, `payment_method_code`,
`payment_method_name`, `payments_count`, `amount_total` (ventas `completed`).

Hasta que existan, el dashboard grafica con `v_cash_session_summary` y
`v_cash_session_payments` (§15.5), que ya están; el margen aparece con esta vista.

### 16.5 Preguntas

| # | Pregunta | Estado |
|---|---|---|
| P-41 | ¿Hay un **tope** al descuento por línea? Con la regla tal cual, 120 unidades darían 100 % | **Decidida (efacelli):** tope de **30 %** por línea, configurable en `sales_settings.quantity_discount_max_percent`; limita el sugerido (36 unidades o más → 30 %) y lo que escribe el cajero | Adoptada |
| P-42 | ¿El cajero puede **subir** el descuento por encima del sugerido (hasta el tope) o solo bajarlo / quitarlo? | **Decidida (efacelli):** puede bajarlo, quitarlo **y subirlo**, entre 0 y el tope, en cualquier línea (también en una que no tenía sugerido) | Adoptada |
| P-43 | Productos por **kg o litro** (cantidades con decimales): ¿"6 unidades" son 6 kg, o el descuento solo aplica a los que se venden por unidad? | **Pendiente (`ChinoNader18`, a pedido de efacelli)** |

### 16.6 Pruebas que se exigirán

Sugerido en 5, 6, 11, 12, 18, 36 y 60 unidades (tope 30 %); editado hacia arriba hasta 30 %; editado a 0, a un valor válido y
fuera de rango (`INVALID_DISCOUNT`); líneas repetidas con porcentajes distintos;
`line_total + discount_amount = list_line_total`; invariantes de §15 intactos
(`Σ line_total = total_amount`, `Σ pagos = total + redondeo`); idempotencia con y sin
`discount_percent`; ventas anteriores a la migración conservan sus importes;
`v_sales_daily` con usuario permitido y denegado.
