# Contrato de datos — Etapa 1

| Campo | Valor |
|---|---|
| Versión | 0.12.0 (propuesta: §22 facturación electrónica ARCA; §21 PLU de balanza en productos, aprobada para implementar; §20 importe manual para productos de balanza y líneas libres, aprobada para implementar; convención de ruta de imágenes de productos, §5.5; propuesta: §18 datos del comercio para el ticket y §19 historial de precios y aumentos masivos; §17 ranking de productos vendidos, aprobada para implementar; rol Programador; ventas y caja §15 implementada en #65; descuentos y métricas §16 aprobada para implementar) |
| Estado | **VIGENTE — EL BACKEND CONCUERDA CON OBSERVACIONES (v0.5.2, §14)** |
| Alcance | Productos, lotes, vencimientos, stock y movimientos; ventas y caja (§15); descuentos por cantidad y métricas de ventas (§16); ranking de productos vendidos (§17); datos del comercio y aumentos de precios (§18 y §19, propuesta) |
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
| `developer` | Programador | v0.7.1 (P-44): **los mismos permisos que `admin`** (todo, incluidos usuarios y `audit_log`). Existe para distinguir a quienes desarrollan el sistema (`efacelli`, `ChinoNader18`) del dueño del súper. En la base, toda comprobación de "dueño" (`private.is_admin()`) y de "encargado o dueño" (`private.is_manager_or_admin()`) también acepta `developer` |
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
| `scale_plu` | `text` | sí | — | **v0.11.0 (§21).** PLU de la balanza (5 dígitos). Solo productos por kilo. Único entre los que lo tienen |
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
  `http://` y `https://`). **Convención de ruta (v0.9.2):** `<product_id>/<uuid>.<ext>`
  (`ext` = `jpg`, `png` o `webp`). Cada carga usa un nombre nuevo; el frontend
  sube el archivo, actualiza `image_path` y recién después borra el anterior (si
  el `UPDATE` falla, borra el recién subido). Antes de subir, la foto se achica a
  1000 px de lado mayor. Para mostrarla se usa una URL firmada que vence a la hora.
  Sin cambios de esquema: el bucket y sus políticas (§9) ya lo permiten.
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
| 0.7.0 | 2026-11-16 | **Propuesta** (§16): descuentos por cantidad (cada 6 unidades 5 %, editable en la caja, todos los productos) con columnas aditivas en `sales_settings`, `sale_items` y `sales`, `register_sale` con `discount_percent` opcional y código `INVALID_DISCOUNT`; vistas `v_sales_daily` y `v_sales_daily_payments` para las finanzas del dashboard. Preguntas P-41 a P-43; P-41 (tope 30 %) y P-42 (el cajero también puede subirlo) decididas por efacelli; P-43 (sugerido solo en cantidades enteras) por `ChinoNader18`, más sus ajustes: `CHECK < 100`, hash con el `discount_percent` enviado, y precisiones de `v_sales_daily` |
| 0.7.1 | 2026-11-16 | Rol Programador (P-44, decisión de `efacelli`; revisado por `ChinoNader18`): rol `developer` ("Programador") con los mismos permisos que `admin`. Migración: `ALTER TYPE app_role ADD VALUE 'developer'` (sola) y `private.is_admin()` / `private.is_manager_or_admin()` aceptan `developer`; pgTAP del rol en la matriz de seguridad. Después, un dueño o programador cambia los perfiles de `efacelli` y `ChinoNader18` desde Configuración → Usuarios |
| 0.8.0 | 2026-11-16 | **Propuesta** (§17): función de lectura `product_sales_ranking(p_from, p_to)` para más vendidos, menos vendidos y sin ventas en X días (solo encargado, dueño y programador); código `INVALID_DATE_RANGE`; preguntas P-46 a P-48 adoptadas. Sin cambios de tablas. Revisada y aprobada por `ChinoNader18`, con sus ajustes: `SECURITY DEFINER`, parámetros nulos → `INVALID_DATE_RANGE` y columna `product_created_at` |
| 0.9.0 | 2026-11-16 | **Propuesta** del backend (issue #68): §18 datos del comercio (`store_name`, `store_address`, `store_tax_id`, nulables, en `sales_settings`) y §19 historial de precios (`price_history`, solo-agregado, escrita por trigger) y aumentos masivos (`price_bulk_changes`, `preview_price_increase`, `apply_price_increase`, `revert_price_change`); errores nuevos y preguntas P-49 a P-54 (P-49, P-52 y P-53 dependen del cliente). P-50, P-51 y P-54 decididas por `efacelli` y ajustes de su revisión incorporados (filtro por producto, productos sin cambio, origen validado en el trigger, bloqueo ordenado, deshacer con inactivos). Quedan abiertas P-49, P-52 y P-53 (cliente). No se implementa hasta aprobarla |
| 0.9.1 | 2026-11-16 | Cierre de las preguntas abiertas de la v0.9.0: P-49 (CUIT del ticket: opcional y por ahora sin cargar, a confirmar con el contador), P-52 (el aumento toca solo el precio de góndola, no costos) y P-53 (múltiplo del redondeo elegido en cada aumento, $10 por defecto en pantalla), decididas por `ChinoNader18` por delegación de `efacelli`. Sin cambios de esquema respecto de la v0.9.0 |
| 0.9.2 | 2026-11-17 | Aclaración sin cambios de esquema: convención de ruta de las imágenes de productos en el bucket `product-images` (§5.5), que el contrato dejaba para cuando el frontend implementara la carga |
| 0.10.0 | 2026-11-17 | **Propuesta** del frontend (§20): importe manual para productos pesados con etiqueta de balanza. Campo opcional `manual_line_total` en los ítems de `register_sale`, columnas aditivas `price_source` y `catalog_line_total` en `sale_items` y código `INVALID_MANUAL_PRICE`; líneas libres sin producto ni stock (§20.8, `INVALID_FREE_ITEM`). P-55 a P-60 decididas. Revisada y aprobada por `ChinoNader18` con sus precisiones: excepción explícita a §15.1, hash sin cambios cuando no hay campos nuevos, margen solo sobre líneas con costo y `free_net_total` en `v_sales_daily`, consistencia diferida sin las líneas libres |
| 0.11.0 | 2026-11-17 | **Propuesta** del frontend (§21): `products.scale_plu` para que la etiqueta de la balanza identifique el producto. El comercio va a armar la lista de PLU de fiambrería. Columna aditiva, `create_product` con `p_scale_plu`, `v_product_list` la expone al final. P-61 a P-63 decididas por `efacelli`. Aprobada por `ChinoNader18` con sus precisiones: firma nueva de `create_product`, errores `23514`/`23505`, `grant update (scale_plu)` |
| 0.12.0 | 2026-11-17 | **Propuesta** del backend (§22): facturación electrónica ARCA desde una Edge Function (WSAA + WSFEv1), `fiscal_settings` y `fiscal_documents`, flujo idempotente, nota de crédito y contingencia CAEA (diseño). P-64 a P-70 abiertas, la mayoría para el contador. Sin datos fiscales del comercio en el repositorio |

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

## 16. Descuentos por cantidad y métricas de ventas (v0.7.0)

> **Aprobada para implementar** (2026-11-16): P-41 a P-43 y P-45 decididas; el backend
> (`ChinoNader18`) la revisó y pidió los ajustes ya incorporados. Las migraciones pasan
> primero por staging. Reemplaza lo que P-28 dejaba "fuera de v0.6.x".

### 16.1 Regla de negocio (decisión de `efacelli`, 2026-11-16)

- **Cada 6 unidades del mismo producto, 5 % de descuento sobre esa línea**, y así
  sucesivamente: 6 → 5 %, 12 → 10 %, 18 → 15 %, … Fórmula sugerida:
  `floor(quantity / step) * percent` con `step = 6` y `percent = 5`.
- Aplica a **todos los productos** (no hay lista de excluidos). En los que se venden por **kg o litro** el
  sugerido es 0, pero el cajero puede aplicar uno a mano hasta el tope (P-43).
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
| `quantity_discount_percent` | `numeric(5,2)` | no | `5` | `CHECK (>= 0 AND < 100)`. Cuánto sube por cada escalón |
| `quantity_discount_max_percent` | `numeric(5,2)` | no | `30` | `CHECK (>= 0 AND < 100)` (con 100 % la línea quedaría en 0 y chocaría con `line_total > 0`). Tope del descuento por línea: limita el sugerido y lo que escribe el cajero (P-41) |

`sale_items` (§15.3.5), columnas nuevas. Las filas ya existentes quedan con
`list_line_total = line_total` y descuentos en 0 (backfill en la misma migración):

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| `list_line_total` | `numeric(12,2)` | no | — | `round(quantity * unit_price_with_vat, 2)`: la línea sin descuento |
| `suggested_discount_percent` | `numeric(5,2)` | no | `0` | Lo que sugirió la regla al vender (para auditar ediciones) |
| `discount_percent` | `numeric(5,2)` | no | `0` | `CHECK (>= 0 AND < 100)`. Lo aplicado |
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
- El `discount_percent` entra en el `request_hash` (idempotencia, §15.6 paso 2) **tal como lo envía el cliente** (`null` si no lo manda), no el resuelto: así un reintento después de cambiar `sales_settings` no da un `IDEMPOTENCY_CONFLICT` falso.
- `private.suggested_discount(quantity, sale_unit, step, percent, max)` =
  `least(floor(quantity / step) * percent, max)` para unidades de cantidades enteras
  (`unit`, `pack`, `box`, `other`) y **0 para `kg` y `l`** (P-43). El frontend aplica la misma
  regla; las pruebas de la base la fijan.

### 16.4 Vista `v_sales_daily` (métricas de finanzas del dashboard)

Una fila por día (fecha local de `sales.created_at` en `America/Argentina/Buenos_Aires`), solo
encargado, dueño y programador (el empleado no ve filas). `security_invoker`. Todas las columnas
cuentan solo ventas `completed` (también `cost_total`), salvo `voided_count`.

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
| P-43 | Productos por **kg o litro** (cantidades con decimales): ¿"6 unidades" son 6 kg, o el descuento solo aplica a los que se venden por unidad? | **Decidida (`ChinoNader18`, a pedido de efacelli):** el sugerido aplica solo a cantidades enteras (`unit`, `pack`, `box`, `other`); en `kg` y `l` es 0, pero el cajero puede aplicar uno a mano hasta el tope. Si el cliente quiere descuento por peso, se agrega después con regla propia (solo cambia `private.suggested_discount`) | Adoptada |
| P-45 | ¿Quién puede editar el porcentaje? | Cualquier usuario activo, entre 0 y 30 % en cualquier línea (P-42). Lo sugerido y lo aplicado quedan en `sale_items`; cuánto se aparta cada empleado sale de `sale_items` + `sales.created_by`. Si más adelante se quiere exigir al encargado por encima de cierto porcentaje, lo valida la RPC | Adoptada |

### 16.6 Pruebas que se exigirán

Sugerido en 5, 6, 11, 12, 18, 36 y 60 unidades (tope 30 %); editado hacia arriba hasta 30 %; editado a 0, a un valor válido y
fuera de rango (`INVALID_DISCOUNT`); líneas repetidas con porcentajes distintos;
`line_total + discount_amount = list_line_total`; invariantes de §15 intactos
(`Σ line_total = total_amount`, `Σ pagos = total + redondeo`); idempotencia con y sin
`discount_percent`; ventas anteriores a la migración conservan sus importes;
`v_sales_daily` con usuario permitido y denegado.

## 17. Ranking de productos vendidos (PROPUESTA v0.8.0)

> **Aprobada para implementar** (2026-11-16, revisión de `ChinoNader18` incorporada:
> `SECURITY DEFINER`, parámetros nulos y `product_created_at`). Solo agrega una
> función de lectura: no cambia tablas, columnas ni datos.

### 17.1 Para qué

Pedido de `efacelli` (2026-11-16): en el dashboard, **los más vendidos**, **los
menos vendidos** y **los productos sin ventas en los últimos X días** (stock
inmovilizado). Hoy el frontend no puede calcularlo sin traer todos los
`sale_items` al navegador, y el empleado solo ve sus propias ventas (§15.7).

### 17.2 Función `product_sales_ranking(p_from date, p_to date)`

`STABLE`, `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` solo para
`authenticated` (convención de la base: toda función de `public` es `SECURITY
DEFINER` y valida el rol adentro; lo verifica `14_security_matrix`). Si el usuario no es encargado, dueño o programador activo
(`private.is_manager_or_admin()`), lanza `NOT_AUTHORIZED` (como §16.4, el
empleado no ve el ranking). Si `p_from` o `p_to` es nulo, `p_from > p_to` o el
rango supera 366 días, lanza `INVALID_DATE_RANGE` (código nuevo).

Devuelve **una fila por producto activo** (también los que no vendieron nada
en el período, con ceros), así el mismo resultado sirve para los tres usos.
Las fechas son locales (`America/Argentina/Buenos_Aires`), ambos extremos
incluidos, igual que `v_sales_daily`. Solo cuentan ventas `completed`.

| Columna | Tipo | Notas |
|---|---|---|
| `product_id` | `uuid` | — |
| `sku` | `text` | Actual del producto |
| `name` | `text` | Actual del producto |
| `brand_name` | `text` | — |
| `category_name` | `text` | — |
| `supplier_name` | `text` (nulable) | — |
| `sale_unit` | `sale_unit` | — |
| `quantity_sold` | `numeric(12,3)` | Σ `sale_items.quantity` en el período; 0 si no vendió |
| `sales_count` | `integer` | Ventas distintas que lo incluyen |
| `revenue_total` | `numeric(12,2)` | Σ `line_total` (con IVA, después del descuento §16 cuando exista) |
| `net_total` | `numeric(12,2)` | Σ `net_amount` |
| `cost_total` | `numeric(12,2)` | Σ `round(quantity * unit_cost_price, 2)` |
| `gross_margin` | `numeric(12,2)` | `net_total − cost_total` |
| `last_sold_at` | `timestamptz` (nulable) | Última venta `completed` **de siempre** (no solo del período); `NULL` si nunca se vendió |
| `stock_quantity` | `numeric(12,3)` | De `v_product_stock`, para ver cuánto stock quedó quieto |
| `product_created_at` | `timestamptz` | `products.created_at`: para no contar como "sin ventas" un producto cargado dentro del período |

Uso desde el frontend (PostgREST permite ordenar y paginar el resultado):

- Más vendidos: `order=quantity_sold.desc` (o `revenue_total.desc`), `limit 10`, `quantity_sold > 0`.
- Menos vendidos: `order=quantity_sold.asc`, `quantity_sold > 0`.
- Sin ventas en X días: `p_from = hoy − X`, `quantity_sold = 0`, `stock_quantity > 0`, `product_created_at < p_from`, orden por `last_sold_at` (nulos primero).

Notas de implementación: `revenue_total` no suma exactamente `v_sales_daily.total_amount`
porque deja afuera los productos inactivos (P-47); el costo es `sale_items.unit_cost_price`
(la copia de la venta, no el costo actual), igual que el margen de `v_sales_daily`.

Índice sugerido si hace falta: `sales (status, created_at)`; `sale_items (product_id)` ya existe (§15.3.5).

### 17.3 Preguntas

| # | Pregunta | Propuesta |
|---|---|---|
| P-46 | ¿"Más vendido" por **cantidad** o por **importe**? | **Adoptada:** las dos columnas; el dashboard deja elegir (por defecto, importe, porque mezcla kg y unidades) |
| P-47 | ¿Incluir productos **inactivos**? | **Adoptada:** no; el ranking es para decidir qué reponer o liquidar; un inactivo con ventas en el período igual aparece en `v_sales_daily` |
| P-48 | ¿Función o vista? | **Adoptada:** función, porque el período es un parámetro; una vista sin parámetros obligaría a agrupar por día y producto (muchas filas) |

### 17.4 Pruebas que se exigirán

Encargado, dueño y programador ven el ranking; empleado e inactivo reciben
`NOT_AUTHORIZED`; anon no puede ejecutar; ventas anuladas no cuentan;
productos sin ventas aparecen con ceros y `last_sold_at` nulo; extremos del
rango incluidos con hora local (venta a las 23:30 del último día); rango
inválido o con parámetros nulos (`INVALID_DATE_RANGE`); `product_created_at`; `gross_margin = net_total − cost_total`;
ventas de varios productos y líneas de kg con decimales.

---

## 18. Datos del comercio para el ticket (PROPUESTA v0.9.0)

> **Propuesta del backend (`ChinoNader18`), a pedido de `efacelli` (issue #68).** No se
> implementa hasta que la apruebe. Solo agrega columnas **nulables** a una tabla existente:
> sin relleno y sin cambios de comportamiento para lo ya hecho.

### 18.1 Para qué

El ticket interno (§15) puede llevar un encabezado con el nombre, la dirección y el CUIT del
comercio. Hoy no hay dónde guardarlos. El ticket sigue diciendo **«NO VÁLIDO COMO FACTURA»**
(P-27).

### 18.2 Columnas nuevas en `sales_settings` (§15.3.8)

Todas nulables (por defecto el ticket sale sin encabezado, como hoy).

| Columna | Tipo | Notas |
|---|---|---|
| `store_name` | `text` | `CHECK (store_name IS NULL OR length(trim(store_name)) BETWEEN 1 AND 80)` |
| `store_address` | `text` | `CHECK (store_address IS NULL OR length(trim(store_address)) BETWEEN 1 AND 120)` |
| `store_tax_id` | `text` | CUIT: **11 dígitos sin guiones**. `CHECK (store_tax_id IS NULL OR store_tax_id ~ '^[0-9]{11}$')`. La base no valida el dígito verificador; el frontend lo muestra con formato `NN-NNNNNNNN-N` |

- Los **leen** todos los usuarios activos (el empleado imprime el ticket) y los **editan** el
  encargado, el dueño y el programador, con el permiso por columna `UPDATE` ya usado en
  `rounding_multiple` y la regla de descuento. Los cambios quedan en `audit_log`.
- Son datos del comercio **que viven solo en la base**: nunca se escriben en el repositorio
  (es público) ni en `seed.sql`.
- Una venta no guarda una copia del encabezado: se imprime con lo vigente al reimprimir.
  (Si más adelante hace falta el encabezado **histórico** de cada venta, se agrega una copia
  en `sales`; hoy no se pide.)

### 18.3 Preguntas

| # | Pregunta | Estado |
|---|---|---|
| P-49 | ¿Se muestra el **CUIT** en un comprobante que no es factura? | **Decidida (`ChinoNader18`, delegada por `efacelli`, 2026-11-16):** el campo existe y es opcional, y el ticket muestra el CUIT **solo si está cargado**. Por ahora **no se carga**: un comprobante interno con CUIT se parece a una factura y conviene que lo confirme el contador junto con la etapa 6 (ARCA). Nombre y dirección sí se pueden cargar ya. Cuando se decida, es cargar el dato en Configuración: no cambia la base ni el frontend | Adoptada |

### 18.4 Pruebas que se exigirán

Las tres columnas son nulas por defecto; el encargado, el dueño y el programador las editan; el
empleado las lee pero su `UPDATE` no cambia nada; `anon` no accede; `store_tax_id` con letras, de
10 o de 12 dígitos → `23514`; nombre o dirección vacíos o demasiado largos → `23514`; cada cambio
queda en `audit_log`; la matriz de seguridad (`14_security_matrix`) sigue pasando.

---

## 19. Historial de precios y aumentos masivos (PROPUESTA v0.9.0)

> **Propuesta del backend, a pedido de `efacelli` (issue #68, etapa futura 2 de `CLAUDE.md`).**
> No se implementa hasta que la apruebe y se resuelvan las preguntas marcadas «cliente».
> Cambiar precios en bloque toca todo el catálogo: por eso hay vista previa, tope, historial y
> deshacer.

### 19.1 Principios

1. El precio que se carga es `products.sale_price` (**sin IVA**, 4 decimales, P-24); el de góndola
   lo calcula la base. Un aumento sube el precio de góndola y se traduce a `sale_price` con
   `round(precio_final / (1 + IVA / 100), 4)`, que reproduce el precio final **al centavo**.
2. **Los costos no se tocan** en esta etapa (cambian con las compras, etapa futura 1).
3. Todo cambio de precio queda en un historial **de solo-agregado**, venga de la pantalla de
   producto, de un aumento masivo o de una reversión.
4. Un aumento masivo es **atómico** (o se aplica a todos los productos elegidos o a ninguno) y
   **idempotente** (§8.5).

### 19.2 Tabla `price_history` (solo-agregado)

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `product_id` | `uuid` | no | FK → `products.id` (`RESTRICT`) |
| `changed_at` | `timestamptz` | no | `now()` |
| `changed_by` | `uuid` | sí | FK → `profiles.id`; `auth.uid()` (nulo en semilla o migración) |
| `old_sale_price` / `new_sale_price` | `numeric(12,4)` | no | Sin IVA |
| `old_cost_price` / `new_cost_price` | `numeric(12,2)` | no | Sin IVA (hoy iguales salvo edición manual) |
| `source` | `text` | no | `CHECK (source IN ('manual','bulk_increase','bulk_revert'))` |
| `bulk_change_id` | `uuid` | sí | FK → `price_bulk_changes.id`; solo para `bulk_*` |
| `reason` | `text` | sí | Motivo o nota |

- **La escribe un trigger** `AFTER UPDATE OF sale_price, cost_price` de `products` (cualquier
  camino que cambie el precio o el costo deja fila, también la edición manual del encargado), no
  el cliente. `source` y `bulk_change_id` los pasan las RPC de §19.4 con `set_config(..., true)`
  (válidos solo dentro de la transacción); sin eso, `source = 'manual'`. **El trigger valida lo que recibe:** si `source` es `bulk_*`, el `bulk_change_id` tiene que existir en `price_bulk_changes` (y `bulk_revert` solo sobre uno ya aplicado); si no, la fila queda como `manual` y sin `bulk_change_id`. Así una edición manual nunca se etiqueta como parte de un aumento.
- Triggers de solo-agregado (`UPDATE`/`DELETE`/`TRUNCATE` rechazados), como `stock_movements`.
- Sin relleno: lo anterior queda en `audit_log`, que ya guarda la fila completa de cada
  producto editado.
- Solo la leen el **encargado, el dueño y el programador** (incluye costos). Índice
  `(product_id, changed_at desc)`.

### 19.3 Tabla `price_bulk_changes` (cada aumento masivo)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `idempotency_key` | `uuid` | `UNIQUE` |
| `created_at`, `created_by` | | Fijados por la base |
| `percent` | `numeric(7,3)` | Aumento sobre el precio de góndola (negativo = baja). `CHECK (percent <> 0 AND abs(percent) <= 50)` |
| `rounding_multiple` | `numeric(12,2)` | Múltiplo del redondeo del precio final; nulo = sin redondeo. `CHECK (> 0)` |
| `brand_ids`, `supplier_ids`, `category_ids`, `product_ids` | `uuid[]` | Filtros usados (nulos = sin ese filtro) |
| `excluded_product_ids` | `uuid[]` | Productos que el usuario sacó de la vista previa |
| `products_count` | `integer` | Cuántos se modificaron |
| `status` | `text` | `applied` o `reverted` |
| `reverted_at`, `reverted_by`, `revert_reason` | | Solo si se deshizo |
| `notes` | `text` | — |

Inmutable salvo el paso `applied → reverted`. La leen y la usan solo encargado, dueño y programador.

### 19.4 Funciones

Todas `SECURITY DEFINER`, `search_path = ''`, solo encargado, dueño y programador
(`private.is_manager_or_admin()`; si no, `NOT_AUTHORIZED`), `EXECUTE` solo para `authenticated`.

**`preview_price_increase(p_brand_ids uuid[], p_supplier_ids uuid[], p_category_ids uuid[], p_product_ids uuid[], p_percent numeric, p_rounding_multiple numeric default null)`**
— `STABLE`, solo lectura. Devuelve una fila por producto **activo** que cumple **todos** los
filtros dados (**marca, proveedor, categoría y producto**; con `p_product_ids` la pantalla elige «estos 40 productos»): `product_id`, `sku`, `name`, `brand_name`, `category_name`, `supplier_name`,
`old_sale_price`, `old_price_with_vat`, `new_sale_price`, `new_price_with_vat`, `change_amount`
(de góndola; **0 si después del redondeo el precio no cambia**, para que la pantalla los muestre como «sin cambio»). Sin ningún filtro → `FILTER_REQUIRED` (para no tocar todo el catálogo sin querer;
ver P-50).

**`apply_price_increase(p_idempotency_key uuid, p_brand_ids uuid[], p_supplier_ids uuid[], p_category_ids uuid[], p_product_ids uuid[], p_percent numeric, p_rounding_multiple numeric default null, p_excluded_product_ids uuid[] default '{}', p_notes text default null) returns price_bulk_changes`**
— **recalcula** todo adentro (no confía en la vista previa del cliente), bloquea los productos
afectados con `FOR UPDATE` **ordenados por `id`** (el mismo orden que usan las ventas, §15: no se traba con una venta ni con otra operación concurrente) y los actualiza en una transacción. Errores: `FILTER_REQUIRED`, `INVALID_PERCENT`
(cero, nulo o más de 50 % en valor absoluto), `INVALID_ROUNDING`, `NO_PRODUCTS` (ningún producto
cumple) e `IDEMPOTENCY_CONFLICT` (misma clave con otros datos). El reintento con la misma clave
devuelve el mismo registro sin aplicar de nuevo.

**`revert_price_change(p_idempotency_key uuid, p_bulk_change_id uuid, p_reason text) returns jsonb`**
— deshace un aumento: devuelve `old_sale_price` solo en los productos cuyo precio **sigue siendo
el que dejó ese aumento**; los que cambiaron después se **saltean** y se informan
(`{"restored": n, "skipped_product_ids": [...]}`). También restaura los productos **que se desactivaron después** del aumento, si su precio sigue igual. Bloquea en el mismo orden que `apply_price_increase`. Cada producto restaurado deja fila
`bulk_revert` en `price_history`. Motivo obligatorio (`REASON_REQUIRED`); ya deshecho →
`ALREADY_REVERTED`; inexistente → `PRICE_CHANGE_NOT_FOUND`.

**Regla de precio:** `nuevo_final = round(round(sale_price × (1 + percent/100), 4) × (1 + IVA/100), 2)`;
con múltiplo `m`: `private.round_price(nuevo_final, m)` = `nuevo_final` si `nuevo_final < m / 2`
(se mantiene exacto), si no el múltiplo más cercano, **desde la mitad sube** (misma idea que
`private.round_cash`, P-30/P-39). Luego `nuevo_sale_price = round(nuevo_final / (1 + IVA/100), 4)`.
El precio nunca queda en 0 ni negativo; si el cálculo diera 0 el producto se saltea y se informa.

**Productos sin cambio:** si después del redondeo `nuevo_sale_price = old_sale_price`, el producto **no se actualiza, no cuenta en `products_count` y no deja fila en `price_history`**.

### 19.5 Códigos de error nuevos

`FILTER_REQUIRED`, `INVALID_PERCENT`, `INVALID_ROUNDING`, `NO_PRODUCTS`, `ALREADY_REVERTED`,
`PRICE_CHANGE_NOT_FOUND`.

### 19.6 Preguntas

| # | Pregunta | Estado |
|---|---|---|
| P-50 | ¿Se permite un aumento a **todo el catálogo** sin filtros? | **Decidida (efacelli, 2026-11-16):** no; sin ningún filtro → `FILTER_REQUIRED`. Con el filtro por producto (`p_product_ids`) alcanza para elegir cualquier lista | Adoptada |
| P-51 | ¿Cuál es el **tope** por operación? | **Decidida (efacelli, 2026-11-16):** 50 % en valor absoluto, **fijo en la base** (cambiarlo es una migración) | Adoptada |
| P-52 | ¿Se ajusta mirando el **costo** o el precio de góndola, y se mantiene el margen? | **Decidida (`ChinoNader18`, delegada por `efacelli`, 2026-11-16):** en esta etapa el aumento se aplica **solo al precio de góndola** (porcentaje sobre el precio vigente) y **no toca costos**. El ajuste por costo y el «mantener el margen» llegan con la etapa de compras (futura 1), cuando el costo se cargue con cada compra; hoy el costo se edita a mano y un cálculo de margen sobre un costo desactualizado daría precios equivocados | Adoptada |
| P-53 | **Múltiplo del redondeo** del precio final ($10, $50…) | **Decidida (`ChinoNader18`, delegada por `efacelli`, 2026-11-16):** el múltiplo **se elige en cada aumento** (parámetro `p_rounding_multiple`, opcional) y la pantalla propone **$10** por defecto; se puede cambiar a $50, $100 o dejarlo vacío (sin redondeo). No hay un valor fijo en la base, así que si el cliente prefiere otro no hace falta ninguna migración | Adoptada |
| P-54 | ¿Qué pasa al **deshacer** si un producto cambió de precio después? | **Decidida (efacelli, 2026-11-16):** se saltea y se informa; nunca se pisa un precio posterior. También se restauran los productos desactivados después, si su precio sigue igual | Adoptada |

### 19.7 Pruebas que se exigirán

Vista previa: filtros combinados con Y (marca, proveedor, categoría y lista de productos), productos «sin cambio» con `change_amount = 0`, sin filtros (`FILTER_REQUIRED`), solo productos activos,
exclusión de productos, redondeo exacto bajo la mitad del múltiplo y hacia arriba desde la mitad,
precio final igual al de la vista previa. Aplicación: atómica (si un producto falla no se aplica
ninguno), idempotente (misma clave dos veces → un solo aumento; otros datos → `IDEMPOTENCY_CONFLICT`),
precio final de góndola exacto al centavo (`sale_price_with_vat`), 0 y 51 % → `INVALID_PERCENT`,
`NO_PRODUCTS`, costos intactos, concurrencia con ventas (las ventas ven el precio viejo o el nuevo,
nunca uno intermedio). Historial: los productos sin cambio no dejan fila ni cuentan; un `source = 'bulk_*'` con un `bulk_change_id` inexistente se guarda como `manual`; una fila por producto cambiado con `source` y `bulk_change_id`
correctos; la edición manual de precio o costo también deja fila; solo-agregado. Deshacer:
restaura solo lo que sigue igual (también productos desactivados después), informa los saltados, `ALREADY_REVERTED`, motivo obligatorio.
Permisos: encargado, dueño y programador sí; empleado, inactivo y `anon` no. Migración sobre
una base con productos y ventas previas: precios, ventas y huella de datos intactos.

---

## 20. Importe manual para productos de balanza y líneas libres (v0.10.0, aprobada)

**Estado:** propuesta del frontend (`efacelli`), **aprobada por el backend (`ChinoNader18`,
2026-11-17)**. La implementa el backend en una rama aparte, con pruebas y paso por staging.

### 20.1 Para qué

La balanza del comercio (Kretz Report NX) imprime etiquetas con código EAN-13 de peso
variable: `20` + PLU (5 dígitos) + **peso en gramos** (5 dígitos) + dígito verificador.
Ejemplo real: `2000005002458` → PLU 5, 0,245 kg. El comercio **no lleva una tabla de qué
PLU es cada producto** y carga la balanza a mano, así que la etiqueta no sirve para saber
qué producto es ni el precio por kilo que usó la balanza.

Decisión de `efacelli` (2026-11-17): al cobrar, la caja toma el peso del código, el
cajero **elige el producto** (solo los que se venden por kilo) y **escribe el importe**
impreso en la etiqueta. Hoy `register_sale` no lo permite: el precio lo calcula siempre
la base (§15.6, paso 4).

**Excepción explícita al principio «el precio lo pone la base» (§15.1).** Este es el único
lugar donde el cliente decide el importe. Queda acotado: solo `sale_unit = 'kg'` (y las
líneas libres de §20.8), importe > 0 con 2 decimales, y la diferencia queda auditable
(`price_source`, `catalog_line_total` y `sales.created_by`).

Decisiones (`efacelli`, 2026-11-17): P-55 **cualquier usuario activo** puede hacerlo
(queda quién vendió, como toda venta); P-56 la base **no limita** la diferencia con el
precio de Zahuy (la caja **avisa** si difiere más de 20 %, sin bloquear); P-57 se permite
**al escanear la etiqueta y también a mano** (peso e importe escritos) por si la etiqueta
no se lee.

### 20.2 `register_sale` (cambio compatible)

Cada elemento de `p_items` admite un campo opcional nuevo:

```
{ "product_id": uuid, "quantity": number, "discount_percent": number|null,
  "manual_line_total": number|null }
```

- Sin `manual_line_total` (o `null`) → todo igual que hoy. Las llamadas actuales siguen
  funcionando.
- Con valor → es el **importe con IVA de la línea**, tal como figura en la etiqueta:
  - Solo para productos con `sale_unit = 'kg'`; si no → `INVALID_MANUAL_PRICE` (nuevo).
  - Mayor que 0 y con hasta 2 decimales (mismo criterio de ruido de coma flotante que
    los importes de §15.6); si no → `INVALID_AMOUNT`.
  - No admite descuento por cantidad: `discount_percent` tiene que ser `null` o `0`; si no
    → `INVALID_DISCOUNT`. (Con P-43 el sugerido de un producto por kilo ya es 0.)
  - Líneas repetidas del mismo producto (dos etiquetas del mismo fiambre): se suman
    cantidades **e importes**. Si unas traen `manual_line_total` y otras no →
    `INVALID_MANUAL_PRICE` (la caja nunca lo arma así).
- El `manual_line_total` entra en el `request_hash` **tal como lo envía el cliente**
  (`null` si no lo manda), igual que `discount_percent` (§16.3). **Cuando ningún ítem lo trae,
  el hash conserva exactamente el formato actual**, así un reintento de una venta hecha antes
  de la migración no da un `IDEMPOTENCY_CONFLICT` falso.
- Stock, FEFO, pagos, redondeo e idempotencia: sin cambios.

### 20.3 Cambios de esquema en `sale_items` (aditivos)

| Columna | Tipo | Null | Default | Notas |
|---|---|---|---|---|
| `price_source` | `text` | no | `'list'` | `CHECK (price_source IN ('list','manual'))`. Las filas existentes quedan en `'list'` |
| `catalog_line_total` | `numeric(12,2)` | sí | — | Solo con `manual`: `round(quantity * products.sale_price_with_vat, 2)` en ese instante, para auditar la diferencia. `CHECK ((price_source = 'manual') = (catalog_line_total IS NOT NULL))` |

Con `price_source = 'manual'`:
- `list_line_total = line_total = manual_line_total` y `discount_amount = 0` (siguen
  valiendo los `CHECK` de §16.2).
- `unit_price_with_vat = round(line_total / quantity, 2)` (informativo; por el redondeo,
  `quantity * unit_price_with_vat` puede diferir de `line_total` en centavos).
- `net_amount` y `vat_amount` se calculan sobre `line_total`, igual que hoy.

### 20.4 Lectura

Las vistas y consultas de ventas no cambian. El frontend lee `price_source` y
`catalog_line_total` con el `select` embebido de ítems para marcar en la venta y en el
ticket las líneas con importe de etiqueta.

### 20.5 Códigos de error nuevos

`INVALID_MANUAL_PRICE`, `INVALID_FREE_ITEM` (§20.8).

### 20.6 Preguntas

| # | Pregunta | Estado |
|---|---|---|
| P-55 | ¿Quién puede cobrar con importe manual? | **Decidida (`efacelli`, 2026-11-17):** cualquier usuario activo | Adoptada |
| P-56 | ¿La base limita la diferencia con el precio de Zahuy? | **Decidida (`efacelli`, 2026-11-17):** no; la caja avisa si difiere más de 20 % y deja cobrar. Queda `catalog_line_total` para auditar | Adoptada |
| P-57 | ¿Solo al escanear la etiqueta o también a mano? | **Decidida (`efacelli`, 2026-11-17):** las dos; la base no distingue el origen | Adoptada |
| P-58 | ¿Hace falta guardar el código escaneado (para detectar una etiqueta cobrada dos veces)? | **Decidida (`efacelli` y `ChinoNader18`, 2026-11-17):** no por ahora; la caja avisa si se escanea el mismo código dos veces en la misma venta. Agregar la columna después es trivial. Con esto, el `products.scale_plu` sugerido en el issue #68 ya no hace falta (el cajero elige el producto) | Adoptada |
| P-59 | ¿Quién agrega líneas libres y qué escribe? | **Decidida (`efacelli`, 2026-11-17):** cualquier usuario activo, con descripción obligatoria | Adoptada |
| P-60 | ¿Qué IVA lleva una línea libre? | **Decidida (`efacelli`, 2026-11-17):** el cajero elige 21 % o 10,5 %, 21 % por defecto | Adoptada |

### 20.8 Líneas libres (productos que no están en el catálogo)

Decisión de `efacelli` (2026-11-17): en la caja se puede cobrar algo que **no está cargado
como producto** (por ejemplo, pan casero de un proveedor ocasional). Hoy no se puede: toda
línea es un producto y descuenta stock de un lote.

Una **línea libre** lleva descripción, IVA, cantidad e importe; **no descuenta stock** y
no genera movimientos. Decisiones: P-59 la agrega **cualquier usuario activo**, con
**descripción obligatoria**; P-60 el cajero elige **IVA 21 % o 10,5 %** (21 % por defecto),
necesario para discriminarlo bien en una factura A.

**`register_sale`:** un ítem sin `product_id` es una línea libre:

```
{ "product_id": null, "description": text, "vat_rate": 21 | 10.5,
  "quantity": integer, "manual_line_total": number }
```

- `description`: 1 a 80 caracteres después de `trim`; `vat_rate` en (10.50, 21.00);
  `quantity` entero ≥ 1; `manual_line_total` > 0 con hasta 2 decimales. Si no →
  `INVALID_FREE_ITEM` (nuevo), salvo el importe, que sigue con `INVALID_AMOUNT`.
- Sin descuento por cantidad (`discount_percent` `null` o `0`; si no → `INVALID_DISCOUNT`).
- No se agrupan: cada línea libre queda como un ítem propio.
- Entran en el `request_hash` con todos sus campos, en el orden en que se envían.

**`sale_items`, cambios (aditivos o de relajar restricciones; las filas existentes no cambian):**

- Quitar el `NOT NULL` de `product_id`, `product_sku` y `unit_cost_price` es solo un cambio de
  metadatos; un `CHECK` asegura que esas tres **solo** pueden ser nulas con `price_source = 'free'`.

- `price_source` admite además `'free'`: `CHECK (price_source IN ('list','manual','free'))`
  y `CHECK ((price_source = 'free') = (product_id IS NULL))`.
- `product_id`, `product_sku` y `unit_cost_price` pasan a **nulables**, solo para
  `free` (sin costo conocido: no entra en el margen). `UNIQUE (sale_id, product_id)` sigue
  valiendo para los productos (los `NULL` no chocan).
- `product_name` guarda la descripción; `unit_price_with_vat = round(line_total / quantity, 2)`;
  `list_line_total = line_total`, `discount_amount = 0`, `catalog_line_total` `NULL`.

**Efectos en lo existente (revisados por `ChinoNader18`, 2026-11-17):**
- `void_sale`: recorre los movimientos de la venta; una línea libre no tiene, así que no hay
  nada que compensar. Sin cambios.
- `product_sales_ranking`: el grupo con `product_id` nulo no coincide con ningún producto y no
  aparece. Sin cambios; se cubre con una prueba.
- **Consistencia diferida de cada venta** (`check_sale_consistency`): hoy exige que el stock
  descontado de cada ítem sea exactamente su cantidad; se **exceptúan** las líneas con
  `price_source = 'free'`, que no tienen movimientos.
- **Margen en `v_sales_daily` (cambia la definición de una columna publicada):** una línea
  libre no tiene costo, y dejarla solo fuera de `cost_total` inflaría el margen con todo su
  neto. Por eso `gross_margin = Σ (net_amount − quantity × unit_cost_price)` **solo de las
  líneas con `unit_cost_price` informado**; `total_amount`, `net_amount` y `vat_amount` siguen
  incluyendo las libres (son ventas reales). Columna nueva `free_net_total` (neto de las
  líneas libres del día), para que el dashboard muestre el margen sobre lo que tiene costo y,
  aparte, lo cobrado en líneas libres.
- **Riesgo conocido (no bloquea):** una línea libre podría usarse para cobrar mercadería del
  catálogo sin descontarla del stock (el faltante aparecería como merma sin explicación). El
  control es el rastro (descripción obligatoria, quién vendió, fecha) y la lista de líneas
  libres recientes para el encargado. Si hiciera falta, un tope por línea libre en
  `sales_settings` (`NULL` = sin tope) se agrega sin migrar datos; lo mismo un tope de
  diferencia para el importe manual (`manual_price_max_ratio`, `NULL` = sin límite) contra
  errores de tipeo como 24.500 en vez de 245,00.
- Lectura: el frontend lista las líneas libres recientes (descripción, importe, fecha,
  quién) para que el encargado decida darlas de alta como producto.

### 20.7 Pruebas que se exigirán

Venta con un ítem manual (importe exacto en `line_total`, `catalog_line_total` con el precio
del momento, IVA discriminado sobre el importe manual), mezclada con ítems normales; dos
líneas manuales del mismo producto se suman; mezcla manual y no manual del mismo producto →
`INVALID_MANUAL_PRICE`; producto por unidad con importe manual → `INVALID_MANUAL_PRICE`;
importe 0, negativo o con 3 decimales → `INVALID_AMOUNT`; con `discount_percent` > 0 →
`INVALID_DISCOUNT`; idempotencia (mismo importe → misma venta; otro importe con la misma
clave → `IDEMPOTENCY_CONFLICT`); anulación de una venta con ítem manual (stock compensado,
importes intactos); ventas anteriores a la migración con `price_source = 'list'`;
empleado activo sí, inactivo y `anon` no. Líneas libres: venta solo con líneas libres y mezclada,
sin movimientos de stock, IVA 10,5 y 21, descripción vacía o de 81 caracteres, IVA 27 y cantidad
fraccionaria → `INVALID_FREE_ITEM`; anulación sin compensaciones; ranking sin las líneas libres;
ventas existentes intactas. Margen diario con una venta mixta (libre + normal) y con una sola
libre (`gross_margin` solo sobre líneas con costo, `free_net_total` correcto); consistencia
diferida con una venta que tiene líneas libres; ranking sin líneas libres; hash de una venta con
líneas libres (mismo orden → misma venta; otro orden o campo → `IDEMPOTENCY_CONFLICT`); hash de
una venta sin campos nuevos idéntico al de antes de la migración.

## 21. PLU de balanza en productos (v0.11.0, aprobada)

**Estado:** propuesta del frontend (`efacelli`), **aprobada por el backend (`ChinoNader18`,
2026-11-17)** con las precisiones de §21.2 y §21.3.

### 21.1 Para qué

Con §20 el cajero elige a mano qué fiambre es cada etiqueta, porque el comercio no tenía
una tabla de PLU. Ahora el comercio va a **armar la lista de productos de fiambrería con
un PLU para cada uno** y cargarla igual en la balanza (Kretz Report NX) y en el sistema.
Con eso, al escanear la etiqueta (`20` + PLU + gramos + verificador, §20.1) la caja ya
sabe qué producto es. Esto revisa lo que decía P-58: `scale_plu` vuelve a hacer falta.

Nada cambia en `register_sale` ni en §20: la venta sigue usando `manual_line_total`. El PLU
solo sirve para **preseleccionar el producto** en el diálogo de la caja.

### 21.2 Cambio de esquema en `products` (aditivo)

| Columna | Tipo | Null | Default | Restricciones / notas |
|---|---|---|---|---|
| `scale_plu` | `text` | sí | — | `CHECK (scale_plu ~ '^[0-9]{5}$' and scale_plu <> '00000')`. `CHECK (scale_plu IS NULL OR sale_unit = 'kg')`. Único parcial `products_scale_plu_key` `WHERE scale_plu IS NOT NULL` |

- Las filas existentes quedan con `NULL`: nada cambia para ellas.
- El PLU se guarda **con los ceros a la izquierda** (`00005`), tal como viene en el código.
  La pantalla acepta `5` y lo completa a `00005`.
- Lo cargan y editan **encargado, dueño y programador**, igual que `legacy_code`.
  `authenticated` tiene `UPDATE` por columna sobre `products`, así que la migración agrega
  `grant update (scale_plu)`; sin eso nadie podría editarlo. El empleado queda frenado por
  `products_restrict_staff_update`, que ya compara el registro completo (no hay que
  cambiarlo). El cambio queda en `audit_log` como cualquier cambio de producto.
- Un producto inactivo **conserva** su PLU (la unicidad lo sigue reservando). Para
  reusarlo hay que borrárselo primero. La caja solo busca entre los activos.
- Si un producto con PLU pasa a otra unidad de venta, el `CHECK` lo rechaza: primero se
  le quita el PLU.
- **Errores** (para que la UI los distinga, como en §8.6):
  - PLU mal formado, PLU en un producto que no es por kilo, o cambio de unidad con PLU
    puesto: `23514` (violación de `CHECK`).
  - PLU repetido: `23505` sobre `products_scale_plu_key` → «Ese PLU ya es de otro producto».

### 21.3 Escritura y lectura

- `create_product` recibe `p_scale_plu text default null` (mismas validaciones). Para que
  PostgREST no quede con dos sobrecargas, la migración **reemplaza** la función (borra la
  firma anterior y crea la nueva con los mismos permisos, sin tocar datos). Los llamadores
  que no pasan el parámetro siguen funcionando por el `default null`. La edición de un
  producto existente es la misma actualización de hoy, con la columna nueva.
- `v_product_list` agrega `scale_plu` **al final** (después de `search_name`), mismas
  columnas y tipos de antes. La búsqueda del frontend usa `ilike` sobre columnas de la
  vista, así que alcanza con incluirla ahí (escribir `00005` encuentra el producto).
- La caja busca directamente en `products` (`scale_plu = :plu`, `is_active`,
  `sale_unit = 'kg'`), con la misma RLS de lectura de productos. No hace falta RPC.

### 21.4 Comportamiento en la caja (frontend)

1. Se escanea la etiqueta. Si hay un producto activo por kilo con ese PLU, el diálogo
   «Producto de balanza» se abre **con ese producto ya elegido** (el cajero lo puede
   cambiar).
2. Si no hay ninguno, el diálogo se abre como hoy (el cajero elige).
3. El importe se sigue escribiendo de la etiqueta (P-61, decidida), con el aviso de §20 si difiere
   más de 20 % del precio de Zahuy.

### 21.5 Carga inicial

El comercio manda la lista (PLU → nombre del producto). La carga se hace desde la app,
producto por producto, o, si son muchos, con un script de una sola vez revisado por las
dos partes, con backup previo y sin tocar otras columnas.

### 21.6 Preguntas

| ID | Pregunta | Propuesta | Estado |
|---|---|---|---|
| P-61 | Con el producto identificado, ¿el importe se sigue escribiendo o se completa con peso × precio de Zahuy? | **Decidida (`efacelli`, 2026-11-17):** se sigue escribiendo; la balanza tiene sus propios precios cargados a mano y la etiqueta es lo que ve el cliente | Adoptada |
| P-62 | ¿El PLU es siempre de 5 dígitos? | **Decidida (`efacelli`, 2026-11-17):** sí, 5 dígitos. Confirmado con una etiqueta real impresa por la Kretz del comercio: `2000005002458` → PLU `00005` con ceros a la izquierda (§20.1). Si la balanza se reconfigurara con otro formato, se ajusta el `CHECK` con otra migración | Adoptada |
| P-63 | ¿Puede un mismo PLU apuntar a dos productos (por ejemplo, el mismo fiambre en dos presentaciones)? | **Decidida (`efacelli`, 2026-11-17):** no, único; si la balanza usa el mismo PLU para dos cosas, la caja no podría distinguirlas | Adoptada |

### 21.7 Pruebas que se exigirán

PLU válido guardado con ceros; `'5'`, `'000005'`, `'0000a'` y `'00000'` rechazados; PLU en un
producto por unidad rechazado; cambiar a otra unidad un producto con PLU rechazado; PLU
repetido → `products_scale_plu_key`; un producto inactivo conserva el PLU; el empleado no
puede cambiarlo y el encargado sí; `create_product` con y sin `p_scale_plu`; `v_product_list`
con la columna al final; productos existentes intactos después de la migración.

## 22. Facturación electrónica ARCA (PROPUESTA v0.12.0)

**Estado:** propuesta del backend (`ChinoNader18`) para revisión de `efacelli` y del contador.
No se implementa nada fiscal en producción hasta aprobarla. Desarrolla lo que §15.8 dejó
reservado para la etapa 6. **No contiene datos del titular** (CUIT, razón social, domicilio,
certificados ni claves): el repositorio es público y esos datos viven solo en secretos de
Supabase y en la carpeta privada del titular.

### 22.1 Alcance y principios

- **Dónde se emite.** Solo desde una Edge Function (backend) con WSAA + WSFEv1 (RG 4291).
  React **nunca** ve certificado, clave privada ni token de ARCA.
- **Ambientes.** `off` (por defecto: la caja sigue emitiendo el ticket interno no fiscal de
  §15), `homologacion` y `produccion`. Se pasa de uno a otro con una decisión explícita,
  nunca por código. Producción exige: revisión del contador, backup verificado y confirmación
  de una persona.
- **Una venta, a lo sumo un comprobante válido.** Idempotencia y conciliación impiden pedir dos
  veces un número. Un comprobante no está autorizado sin respuesta afirmativa de ARCA con CAE.
- **Nada fiscal en `sales`.** El comprobante es una tabla aparte; la venta y el stock no
  cambian (§15.8).
- **Emisor.** Responsable inscripto en IVA, punto de venta «RECE para aplicativo y web
  services». El comprobante usa lo que la venta ya guarda: neto, IVA y total por ítem (§15, §20).

### 22.2 Tablas (aditivas)

**`fiscal_settings`** — una sola fila. `environment` (`off` | `homologacion` | `produccion`,
por defecto `off`), `pto_vta integer` (punto de venta de web services), `caea_pto_vta integer`
nulo (punto de venta propio para contingencia, §22.6), `updated_at`, `updated_by`. Escribe
solo el dueño o el programador. **El CUIT no se guarda en la base**: es un secreto de la
función.

**`fiscal_documents`** — solo agregado, escrita únicamente por la función con `service_role`
(los usuarios autenticados solo leen).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `sale_id` | `uuid` | FK `sales`; **único parcial** `WHERE status IN ('pending','authorized','unknown')`: una venta tiene a lo sumo un comprobante vivo |
| `kind` | `text` | `invoice` o `credit_note` |
| `cbte_tipo` | `smallint` | código ARCA (1 A, 6 B, 3 NC A, 8 NC B, …) |
| `pto_vta` | `integer` | |
| `cbte_nro` | `bigint` | nulo hasta obtenerlo; único `(environment, pto_vta, cbte_tipo, cbte_nro)` |
| `environment` | `text` | `homologacion` o `produccion`: un documento de homologación **nunca** se mezcla con uno de producción |
| `status` | `text` | `pending`, `authorized`, `rejected` o `unknown` |
| `authorization_kind` | `text` | `CAE` o `CAEA` |
| `cae` | `text` | 14 dígitos; obligatorio si `authorized` |
| `cae_expires_on` | `date` | |
| `receiver_doc_type`, `receiver_doc_number` | `smallint`, `text` | 99 y 0 = consumidor final |
| `receiver_vat_condition_id` | `smallint` | condición frente al IVA del receptor (campo exigido por ARCA en la solicitud; confirmar contra el manual vigente) |
| `imp_total`, `imp_neto`, `imp_iva` | `numeric(12,2)` | deben coincidir con la venta (§22.4) |
| `iva_breakdown` | `jsonb` | por alícuota (10,5 % y 21 %): base e importe |
| `request_payload`, `response_payload` | `jsonb` | tal cual; **sin** token, firma ni clave |
| `observations` | `jsonb` | observaciones y errores de ARCA |
| `idempotency_key` | `uuid` | único |
| `created_by`, `created_at`, `authorized_at` | | auditoría |

Reglas: un documento `authorized` **no se modifica ni se borra** (trigger); se corrige con una
nota de crédito. Con RLS: leen encargado, dueño y programador; el empleado, solo los de las
ventas que cobró.

### 22.3 Flujo (función `arca-emitir`)

1. La caja registra la venta como hoy (`register_sale`, sin cambios).
2. Si `fiscal_settings.environment` no es `off`, el frontend llama a la función con `sale_id` y,
   si corresponde, los datos del receptor.
3. La función inserta el documento `pending` (idempotente por clave), pide a ARCA el último
   número autorizado (`FECompUltimoAutorizado`), solicita el CAE (`FECAESolicitar`) y guarda la
   respuesta completa en una sola transacción: `authorized` o `rejected`.
4. **Si la respuesta no llega** (corte, tiempo agotado) el documento queda `unknown` y **no se
   reintenta a ciegas**: primero se consulta (`FECompConsultar`) por ese número. Solo así se
   evita emitir dos veces.
5. La venta ya está cobrada y el stock descontado pase lo que pase con ARCA: una falla fiscal
   nunca deshace una venta. Queda pendiente de facturar y se reintenta.

### 22.4 Importes

**El comprobante lleva el importe cobrado** (decisión de P-66: el comercio redondea el efectivo,
generalmente hacia abajo): `imp_total = total_amount + rounding_amount`, que es lo que el cliente
pagó. Neto e IVA por alícuota salen de los ítems de la venta (incluidas las líneas libres, §20.8, con
su IVA y sin producto). Si hay redondeo, la diferencia entre lo cobrado y el bruto de los ítems se
reparte **proporcionalmente al bruto de cada alícuota**, en centavos, y la última alícuota absorbe
el resto para que la suma dé exactamente lo cobrado; de cada bruto ajustado, `base = round(bruto /
(1 + tasa), 2)` e IVA = bruto − base. Sin redondeo, los importes son los de los ítems tal cual.
Ejemplo: 2.315 cobrados 2.300 (21 % y 10,5 %) → neto 1.987,04 + IVA 312,96 = 2.300,00.

### 22.5 Anulación

Una venta con comprobante `authorized` **no se puede anular a secas**: `void_sale` falla con
`FISCAL_DOCUMENT_EXISTS` y la corrección es una nota de crédito (`kind = credit_note`,
asociada al comprobante original). Mientras no se decida (P-67) no se cambia `void_sale`.

### 22.6 Contingencia (diseño, sin implementar)

Primera opción ante cortes: **CAEA** (RG 5782) con un **punto de venta específico** distinto del
de CAE. Un CAEA por contribuyente y por quincena (días 1 a 15 y 16 a fin de mes), que se pide
desde cinco días antes; lo emitido con CAEA se informa a ARCA hasta el octavo día posterior al
cierre del período, y también los puntos de venta no usados. La excepcionalidad se vigila: si lo
emitido por contingencia llega al 5 % del total de la sucursal en dos meses seguidos (o tres
alternados), ARCA puede obligar a usar controlador fiscal. Tabla futura: `arca_caea` (período,
código, vigencia, informado).

### 22.7 Preguntas abiertas (dependen del contador salvo aviso)

| ID | Pregunta | Propuesta | Estado |
|---|---|---|---|
| P-64 | ¿Factura B a consumidor final en **todas** las ventas, o solo cuando el cliente la pide? ¿Desde qué importe hay que identificarlo? | Emisión opt-in por venta al principio; identificación según el umbral vigente que informa ARCA (a confirmar) | **Confirmada por el contador (2026-11-17):** facturar **solo a pedido** del cliente es válido y **no hay obligación de emitir un comprobante en todas las ventas**. Las demás ventas se guardan con el botón «Guardar sin ticket» (PR #101, sin cambios en la base) o con el ticket interno |
| P-65 | ¿Se vende a responsables inscriptos (Factura A)? Los clientes aún no existen en el sistema | Cargar CUIT y condición de IVA en la venta, sin tabla de clientes. **Qué clase corresponde lo dice ARCA** (`FEParamGetCondicionIvaReceptor`, verificado en homologación): **A** para responsable inscripto (1), monotributo (6), monotributista social (13) y monotributo trabajador independiente promovido (16); **B** para IVA exento (4), consumidor final (5), sujeto no categorizado (7), proveedor del exterior (8), cliente del exterior (9), IVA liberado Ley 19.640 (10) e IVA no alcanzado (15). El comercio emite A y B todos los días | **Resuelta** (ARCA y comercio) |
| P-66 | El redondeo de efectivo, ¿entra al importe del comprobante? | El comprobante lleva el **importe cobrado, ya redondeado** (`total_amount + rounding_amount`), generalmente hacia abajo: el comercio maneja precios sin centavos. Neto e IVA por alícuota se recalculan proporcionalmente (§22.4) | **Confirmada por el contador (2026-11-17):** el comprobante lleva el **importe cobrado y redondeado**, generalmente hacia abajo. Implementado (§22.4, PR #103) |
| P-67 | Anulación de una venta ya facturada | Nota de crédito (§22.5) **sin plazo impuesto por el sistema** | **Respondida (respuesta recibida el 2026-11-17):** la nota de crédito se emite enseguida (por un error al facturar) o a la brevedad (devolución del cliente); no hay un plazo estipulado |
| P-68 | ¿Qué hace el comercio si ARCA no responde en el mostrador? | Cobrar, entregar ticket y facturar apenas vuelva; contingencia CAEA como segunda opción. ARCA indica **CAEA como primera opción** con web service y exige un punto de venta propio | **Respondida** (comercio y documentación de ARCA). Queda decidir si se da de alta el punto de venta de CAEA |
| P-69 | ¿Cuándo se pasa a producción y con qué puesto piloto? | Después de homologación completa y una prueba con el contador | Abierta (dueño y contador) |
| P-70 | ¿Se imprime el código QR de ARCA en el ticket o PDF fiscal? | Sí (es parte del comprobante); lo arma el frontend con los datos del documento autorizado | Abierta (`efacelli`) |
| P-71 | ¿Hay percepciones que informar en los comprobantes? | No | **Respondida (respuesta recibida el 2026-11-17):** no hay; «el ticket sale final ya» |
| P-72 | Umbral desde el cual hay que identificar al consumidor final | $10.000.000 (lo indica ARCA) | **Confirmada (respuesta recibida el 2026-11-17):** sigue vigente |
| P-73 | ¿El domicilio del punto de venta es el del local? | Sí | **Confirmada (respuesta recibida el 2026-11-17):** es el mismo domicilio |
| P-74 | ¿Hay productos con IVA distinto de 21 % o 10,5 %? | No | **Confirmada (respuesta recibida el 2026-11-17):** todos tienen 21 % o 10,5 % |
| P-75 | ¿Hay algo que revisar antes de emitir en producción? | Revisión del contador y un puesto piloto | **Respondida (respuesta recibida el 2026-11-17):** no hay nada pendiente del titular que pueda trabar o limitar la emisión y el punto de venta está bien habilitado. Sobre la caja piloto, **al contador le da lo mismo empezar con una o con las dos cajas**: no hay inconveniente |

### 22.8 Pruebas que se exigirán

Con homologación (nunca producción): autenticación WSAA con ticket reutilizado hasta su
vencimiento; `FEDummy`; último número autorizado; factura B de consumidor final con IVA 21 % y
10,5 %; rechazo por dato inválido (queda `rejected` con la observación); corte simulado en la
respuesta → `unknown` → consulta → sin duplicado; reintento con la misma clave → mismo
documento; dos solicitudes simultáneas sobre la misma venta → un solo comprobante vivo; un
documento `authorized` no se edita ni se borra; empleado y `anon` no escriben; importes del
comprobante = importes de la venta; el ticket interno de §15 sigue idéntico con el ambiente en
`off`; ningún secreto ni token en `request_payload`, `response_payload` ni en los registros.

### 22.9 Implementación de la capa de base de datos (backend, v0.12.0)

**Estado:** implementada y probada en local (migración `20261121100000_fiscal_documents.sql`, prueba
`26_fiscal_documents`). **Solo la base**: la Edge Function que habla con ARCA y todo lo que dependa de
las respuestas del contador (P-64 a P-70) siguen pendientes. Con `fiscal_settings.environment = 'off'`
(valor por defecto) nada cambia para la caja. Diferencias con lo propuesto arriba:

- **`fiscal_documents.cbte_nro` es `NOT NULL`**: el número se **reserva al empezar** (`fiscal_begin`)
  bajo un bloqueo por ambiente, punto de venta y tipo, y vale `greatest(último autorizado por ARCA,
  mayor número ya reservado aquí) + 1`. Un documento **rechazado no consumió el número** en ARCA: no
  cuenta para esa cuenta y su número se reusa (el único `(environment, pto_vta, cbte_tipo, cbte_nro)`
  excluye los rechazados). Probado con 12 conexiones simultáneas: números 1 a 12, sin repetir.
- **Columna nueva `original_document_id`** (la nota de crédito apunta a su factura). Una nota de
  crédito solo se crea sobre una factura autorizada de la misma venta, ambiente y punto de venta, y su
  código es el de la factura + 2 (A: 1 → 3, B: 6 → 8).
- **El ticket de acceso de ARCA** vive en `private.fiscal_tickets` (fuera del esquema expuesto), una
  fila por ambiente y servicio, y se usa solo con `fiscal_ticket_get` / `fiscal_ticket_save`
  (`service_role`). `fiscal_ticket_get` no devuelve un ticket que venza en menos de 2 minutos.
  Motivo: ARCA **no entrega otro ticket mientras el anterior siga vigente** (`coe.alreadyAuthenticated`,
  verificado en homologación) y la memoria de una función se pierde al reiniciarla.
- **Funciones (solo `service_role`, `SECURITY DEFINER`, `search_path` vacío):**
  - `fiscal_begin(p_idempotency_key, p_sale_id, p_kind, p_cbte_tipo, p_arca_last, p_created_by,
    p_receiver_doc_type = 99, p_receiver_doc_number = '0', p_receiver_vat_condition_id = 5,
    p_original_document_id = null) → fiscal_documents`: idempotente por clave, devuelve el comprobante
    vivo si la venta ya lo tiene (se retoma, no se duplica) y arma `iva_breakdown` desde los ítems de la
    venta (alícuota 10,5 % = id 4, 21 % = id 5; otra alícuota → `FISCAL_UNSUPPORTED_VAT`).
  - `fiscal_finish(p_document_id, p_status, p_cae, p_cae_expires_on, p_request, p_response,
    p_observations) → fiscal_documents`: `authorized`, `rejected` o `unknown`.
- **Protecciones de la tabla** (valen para cualquier escritor): un documento nace `pending`; su
  total debe ser lo cobrado (`total_amount + rounding_amount`) y su desglose por alícuota debe sumar el
  neto y el IVA (migración `20261121110000_fiscal_charged_amount.sql`); `authorized` y `rejected` no se modifican ni se
  borran; `pending → authorized | rejected | unknown` y `unknown → authorized | rejected | unknown`;
  `request_payload` y `response_payload` nunca llevan `token` ni `sign`.
- **Pasar a `produccion`** exige haber autorizado antes al menos un comprobante en `homologacion`
  (`PRODUCTION_NOT_READY`). Solo lo hacen el dueño o el programador.
- **Anulación (§22.5):** un trigger en `sales` impide anular una venta con factura autorizada que no
  tenga una nota de crédito autorizada (`FISCAL_DOCUMENT_EXISTS`). Una venta sin comprobante se anula
  como siempre. No se tocó `void_sale`.
- **Permisos de lectura:** `fiscal_settings` la lee todo usuario activo (la caja necesita saber si
  factura) y solo la edita el dueño o el programador; `fiscal_documents` la lee el encargado, el
  dueño y el programador, y el empleado solo la de las ventas que cobró.
- **Códigos de error nuevos:** `FISCAL_DISABLED`, `FISCAL_AMOUNT_MISMATCH`, `FISCAL_UNSUPPORTED_VAT`,
  `FISCAL_DOCUMENT_IMMUTABLE`, `FISCAL_DOCUMENT_EXISTS`, `INVALID_FISCAL_TRANSITION`,
  `INVALID_FISCAL_DOCUMENT`, `PRODUCTION_NOT_READY`; se reusan `SALE_NOT_FOUND`, `SALE_VOIDED` e
  `IDEMPOTENCY_CONFLICT`.
- **Sin implementar:** la función `arca-emitir`, la consulta `FECompConsultar` ante un `unknown`, el
  CAEA (`arca_caea`) y la pantalla de facturación.

### 22.10 Función `arca-emitir` (backend, homologación)

**Estado:** implementada en `supabase/functions/arca-emitir` y probada contra ARCA de **homologación** (ver su
README). Solo emite en homologación; con el ambiente en `produccion` responde 501. Un pedido es
`POST { sale_id, idempotency_key, receiver? }` con la sesión del usuario; el usuario debe estar activo y poder
ver la venta. Respuestas: 200 autorizada, 202 en curso (repetir con la misma clave), 422 rechazada.

- **Reserva atómica del envío:** columna `fiscal_documents.sent_at` y función `fiscal_claim(p_document_id)`
  (`service_role`): solo una llamada envía el comprobante a ARCA; las demás esperan o concilian. Evita que
  un rechazo por número repetido pise el CAE ya emitido.
- **Sin respuesta de ARCA:** el documento queda `unknown` y **no se reenvía**. Pasados ~2 minutos desde el
  envío, la siguiente llamada consulta a ARCA (`FECompConsultar`): lo autoriza con el CAE de ARCA si coincide el
  importe, lo deja para una persona si no coincide (`MISMATCH_WITH_ARCA`) o lo da por rechazado si ARCA
  confirma que no existe (código 602).
- **Factura A o B:** la dicta ARCA (`FEParamGetCondicionIvaReceptor`): A para responsable inscripto,
  monotributo, monotributista social y monotributo trabajador independiente promovido (con CUIT del
  receptor); B para el resto. Desde $10.000.000 se exige identificar al comprador (P-72).
- **Ticket de acceso:** se guarda con `fiscal_ticket_save`; si ARCA ya entregó uno que no está guardado, la
  función responde 503 (`TICKET_UNAVAILABLE`) hasta que venza.
- **Códigos nuevos de la función:** `NOT_AUTHENTICATED` (401), `INVALID_RECEIVER`, `IDENTIFICATION_REQUIRED`,
  `PRODUCTION_NOT_IMPLEMENTED`, `TICKET_UNAVAILABLE`, `ARCA_ERROR`.
- **Nota de crédito (§22.5):** `action: "credit_note"` emite la nota de crédito de la factura autorizada de la
  venta (tipo de la factura + 2, mismos importes y receptor, con el comprobante asociado `CbtesAsoc`);
  `409 NO_INVOICE` si no hay factura autorizada. Verificada en homologación: ARCA la tiene con el mismo CAE y,
  recién después, la venta se anula.
- **Desplegada en staging** (2026-11-17) y verificada en el runtime real. **Sin implementar:** CAEA y emitir en producción (§22.1).

### 22.11 Datos del emisor, comprobante impreso con QR y configuración (v0.12.0)

**Estado:** implementado (migración `20261121130000_fiscal_issuer_details.sql`, pantallas de Ventas y de
Configuración). Cierra lo que P-70 dejaba abierto.

- **Datos del emisor en `fiscal_settings`** (nulables, sin dato cargado: el repositorio es público; se cargan
  desde la app y viven solo en la base): `issuer_name` (razón social, 1 a 80), `issuer_tax_id` (CUIT, 11
  dígitos), `issuer_address` (domicilio comercial, 1 a 120), `gross_income_number` (dígitos y guiones, hasta
  20) y `activity_start_date`. Son **datos fiscales distintos de `sales_settings.store_*`**, para no cambiar el
  ticket interno (P-49: un comprobante interno con CUIT se parece a una factura). Los edita el dueño o el
  programador y los lee todo usuario activo, para imprimir.
- **Comprobante impreso:** con un comprobante autorizado, el detalle de la venta imprime el comprobante fiscal y
  **no** el ticket interno. Lleva razón social, domicilio, CUIT y condición de IVA del emisor, Ingresos Brutos,
  inicio de actividades, tipo y número, fecha, cliente, detalle, total, el IVA (Factura B: «IVA contenido»;
  Factura A: neto gravado e IVA por alícuota), un «Ajuste por redondeo» si el importe cobrado difiere del detalle,
  CAE, vencimiento del CAE y el **código QR de ARCA**. En homologación dice «PRUEBA · SIN VALIDEZ FISCAL». Si faltan
  datos del emisor lo avisa. Una nota de crédito indica qué factura anula.
- **Código QR (RG 4892):** URL `https://www.afip.gob.ar/fe/qr/?p=` + base64 de un JSON con `ver` 1, `fecha`
  (día en Argentina), `cuit`, `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda` `PES`, `ctz` 1, `tipoDocRec`,
  `nroDocRec`, `tipoCodAut` `E` y `codAut` (el CAE). Se dibuja en el navegador con `qrcode-generator` (MIT, sin
  dependencias).
- **Configuración fiscal desde la app (solo dueño y programador):** ambiente (apagada o prueba), punto de venta,
  punto de venta de CAEA y datos del emisor. **Producción no se activa ni se desactiva desde la app** (§22.1).
- **Comprobante sin confirmar:** la pantalla lo vuelve a consultar sola cada 20 segundos (hasta 12 veces) mientras
  esté abierta; la función concilia con ARCA pasados ~2 minutos.
