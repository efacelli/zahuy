# Plan de despliegue — Etapa 1

| Campo | Valor |
|---|---|
| Estado | **PROPUESTO — requiere aprobación de `efacelli` antes de ejecutar cualquier paso marcado 🔒** |
| Alcance | Primera puesta en producción: base Supabase, autenticación y frontend |
| Repositorio | Público: nada de este plan lleva claves, contraseñas ni datos del negocio |

Regla de CLAUDE.md: nada se despliega, ni se toca producción, ni se cambian
credenciales sin autorización explícita. Los pasos 🔒 los aprueba (y en general
los ejecuta) una persona; Claude prepara, revisa y verifica.

---

## 1. Decisiones pendientes

| # | Decisión | Propuesta | Por qué |
|---|---|---|---|
| D-1 | Plan de Supabase para producción | **Decidido (2026-11-15, `efacelli`): gratuito por ahora.** Pasar a Pro (USD 25/mes) cuando haya datos reales que no se puedan volver a cargar | El gratuito pausa el proyecto tras 7 días sin actividad (con uso diario no pasa) y **no tiene backups automáticos**: se compensa con el backup manual semanal de §7 |
| D-2 | Ambiente de prueba (staging) | Un segundo proyecto Supabase **gratuito**, solo con datos ficticios | Probar cada migración en una base igual a producción antes de aplicarla. Que se pause no importa |
| D-3 | Hosting del frontend | **Decidido: Render, sitio estático**, en la cuenta de `efacelli` (ya paga Starter; el sitio estático no suma costo) | La app es un sitio estático (Vite). El plan gratuito de Vercel (Hobby) es solo para uso no comercial |
| D-4 | Región de la base | **São Paulo (`sa-east-1`)** | La más cercana a Argentina |
| D-5 | Dominio | Subdominio de Render al principio (`*.onrender.com`); dominio propio opcional después | Sin costo ni trámite para empezar |
| D-6 | Dueños de las cuentas (Supabase, Render, GitHub) | Dueño y encargado del negocio como administradores (respuesta 36), desarrolladores como miembros | Que el negocio no dependa de una sola persona |
| D-7 | Carga inicial de productos reales | A definir: a mano desde la app, o una importación (no existe todavía) | Cuántos productos son y en qué formato los tienen |
| D-8 | Quién aplica migraciones en producción | `efacelli` (o quien designe), siempre después de staging y con backup | Un solo responsable evita aplicar dos veces o fuera de orden |

Costo mensual con lo decidido: **USD 0 adicionales** (Supabase gratuito y sitio
estático de Render). Con Supabase Pro serían USD 25. Verificar precios vigentes.

---

## 2. Preparación (sin tocar producción)

Ya hecho o que Claude puede dejar listo en el repo:

- [x] Migraciones versionadas, solo aditivas, con pruebas pgTAP (`supabase test db`).
- [x] RLS en todas las tablas; `anon` sin acceso; claves privilegiadas rechazadas en el navegador (`src/lib/env.ts`).
- [x] `render.yaml`: sitio estático, build `npm ci && npm run build`, publica `dist/`, reescritura de rutas a `index.html` y encabezados de seguridad.
- [x] Versión de Node fijada (`.node-version` y `engines`).
- [x] CI corre también las pruebas de la base (job "Base de datos (migraciones y pgTAP)").
- [ ] 🔒 Marcar ese job como obligatorio en la protección de `main` (cambio de configuración del repo).
- [x] Bucket privado `product-images` con sus políticas (migración `20261116230000`).

---

## 3. Crear los proyectos 🔒

Lo hace una persona con la cuenta del negocio (crear cuentas y pagar no lo hace Claude).

1. Crear la organización en Supabase con el email del negocio y sumar a los responsables (D-6).
2. Crear **`zahuy-staging`** (gratis) y **`zahuy-prod`** (Pro), región D-4.
3. Guardar la contraseña de la base de cada proyecto en un gestor de contraseñas. **Nunca** en el repo, chats ni documentos.

### Staging: `zahuy-staging` (decisión de `efacelli`, 2026-11-15)

- Lo crea `efacelli` en la organización **Zahuy** de Supabase: región **São Paulo**, plan gratuito. Invita al backend como **Developer**.
- **Solo datos ficticios.** En staging sí se carga `supabase/seed.sql` (con `db push --remote --include-seed` la primera vez). Los usuarios de prueba se crean a mano en Authentication → Users con correos ficticios y contraseñas fuertes: `npm run db:users` solo funciona contra la base local y se niega a tocar otra URL. **Nunca** datos reales, ni un backup de producción, ni el backup real del negocio.
- Es un paso **obligatorio** antes de producción (§8): ninguna migración llega a producción sin haberse aplicado y probado antes en staging.
- Secretos de staging (contraseña de la base, claves, certificados de homologación de ARCA, `.env`): en el gestor de contraseñas, nunca en el repo, chats ni documentos. Las claves `service_role`/`sb_secret_` no se usan en el frontend ni se pegan en ningún lado.
- Pasos para dejarlo listo (🔒, los hace una persona o el backend con la invitación ya aceptada y la contraseña tecleada por esa persona):
  1. Auth igual que producción (tabla siguiente): sin registro público, contraseña de 10 o más con letras y números. **Staging no lleva Site URL ni sitio propio** (decisión del equipo, 2026-11-16): se prueba contra la base por la API y con la app local.
  2. `npx supabase@3.1.0 link --project-ref <ref-de-staging>` (pide la contraseña de la base).
  3. `npx supabase@3.1.0 db push --remote --dry-run`, revisar, y después `db push --remote --include-seed`.
  4. Verificar: RLS en todas las tablas, *Security Advisor* sin alertas críticas, un usuario `admin` de prueba (procedimiento de §4, Primer dueño) y una prueba manual.
- Opcional, sin costo: un segundo sitio estático en Render apuntando a staging (§5) para probar la app completa.

**Estado (2026-11-16):** `zahuy-staging` creado, con las 23 migraciones de entonces y el seed ficticio aplicados, Auth configurado (sin registro público, contraseña de 10 con letras y números) y probado: 0 tablas sin RLS, `anon` sin acceso, 0 descuadres de stock y una prueba de humo de ventas y caja por la API (20 de 20). El backup de datos de staging se descargó y se restauró en una base local con huella idéntica (§7.1). No se configura Site URL de staging (no habrá sitio de staging).

### Configuración de Auth (en los dos proyectos)

| Opción | Valor | Motivo |
|---|---|---|
| Permitir registros (signups) | **Desactivado** | Las cuentas las crea el dueño (§5.1); nadie se registra solo |
| Largo mínimo de contraseña | **10** | Local usa 6 solo para pruebas |
| Requisitos de contraseña | Letras y números | — |
| Site URL | URL de Render (D-5) | Enlaces de recuperación de contraseña |
| Redirect URLs | Solo la URL de producción (y la de staging en su proyecto) | Evita redirecciones a sitios ajenos |
| Email (SMTP) | El incluido alcanza para empezar (pocas recuperaciones). Si se usan mucho, configurar un SMTP propio | Límite bajo de envíos del SMTP por defecto |

---

## 4. Aplicar el esquema 🔒

Primero en staging, después en producción, siempre en este orden.

```bash
npx supabase@3.1.0 link --project-ref <ref-del-proyecto>   # pide la contraseña de la base: la escribe la persona
npx supabase@3.1.0 db push --remote --dry-run               # lista lo que se va a aplicar; revisar
npx supabase@3.1.0 db push --remote                         # aplica las migraciones pendientes
```

- **Cómo se aplicó en staging (se repite igual en producción, cambiando el proyecto):** el CLI se conecta con la sesión de `supabase login` (no hace falta escribir la contraseña de la base en ningún lado; `link` y `db push --dry-run` funcionan solos). En modo no interactivo (por ejemplo, ejecutado por un agente) la CLI exige `--yes` para cambiar un proyecto remoto; **sin `--yes` no cambia nada**. Antes de cada paso, confirmar el nombre y el ref con `npx supabase@3.1.0 projects list` y `cat supabase/.temp/project-ref`. La CLI rotula los proyectos con un entorno ("production") que es una etiqueta del proyecto, no prueba de que sea producción: fiarse del nombre y del ref.
- **Auth sin la interfaz web:** `config push` aplica solo las propiedades que declara el `config.toml` que se le pasa; las que no declara quedan como están. Para configurar Auth igual que producción sin heredar los ajustes de desarrollo local (contraseñas de 6), usar un `config.toml` mínimo **fuera del repo** con `[auth] enable_signup = false`, `minimum_password_length = 10`, `password_requirements = "letters_digits"` y correr `npx supabase@3.1.0 config diff --workdir <carpeta>` y, si coincide con lo esperado, `config push --workdir <carpeta> --yes`. Nunca correr `config push` con el `supabase/config.toml` del repo contra staging o producción: trae los valores de desarrollo local.
- **Verificar sin riesgo:** `npx supabase@3.1.0 db query --remote --read-only "<SQL>"` (conteos, RLS, `anon`, conciliación de stock) y `npx supabase@3.1.0 db advisors --remote` (*Security Advisor*). Las advertencias esperadas hoy: las RPC son `SECURITY DEFINER` ejecutables por usuarios con sesión (validan el rol adentro) y la protección contra contraseñas filtradas, que exige plan Pro. **`db reset --remote` existe: no se usa jamás contra staging ni producción.**
- **Usuarios de prueba en staging:** `npm run db:users` solo corre en local. En staging se crean en Authentication → Users o con la API de administración de Auth desde la computadora de un responsable (la clave de administración nunca se guarda ni se sube).
- **Ojo con la versión de la CLI:** en la 3.1.0, `db push` apunta a la base **local** si no se pasa `--remote` (lo dice su ayuda: "Local by default"). Sin `--remote`, el comando "funciona" pero no aplica nada en el proyecto vinculado. Revisar siempre la salida de `--dry-run` para confirmar a qué base apunta.
- **Nunca** cargar `supabase/seed.sql` en producción: `db push` no lo aplica salvo que se pase `--include-seed`, y esa opción **no se usa en producción**. En staging sí (datos ficticios).
- En staging: correr las pruebas contra esa base y una prueba manual con datos ficticios.
- Verificar en el panel: RLS activa en todas las tablas, *Security Advisor* sin alertas críticas.

### Primer dueño

1. En Authentication → Users, crear el usuario del dueño (email real, contraseña fuerte que define él).
2. En el SQL Editor, promoverlo una sola vez (procedimiento de `supabase/README.md`, §5.1 del contrato):
   ```sql
   update public.profiles set role = 'admin' where id = '<id del usuario>';
   ```
3. El resto de los usuarios se crea en Authentication → Users y el dueño les asigna el rol desde **Configuración → Usuarios**.

---

## 5. Publicar el frontend 🔒

1. En Render: *New → Blueprint* con este repositorio (lee `render.yaml`) o *New → Static Site* con los mismos valores.
2. Variables de entorno (en el panel de Render, no en el repo):
   - `VITE_SUPABASE_URL` = URL del proyecto de producción
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = clave **pública** (publishable). Nunca la `service_role` ni `sb_secret_…`: la app no arranca si la detecta.
3. Despliegue automático desde `main` **después** de que pase el CI. Un sitio estático aparte para staging es opcional (sin costo): mismo repositorio y mismos pasos, con `VITE_SUPABASE_URL` y la clave **publishable** del proyecto de **staging**, Site URL y Redirect URLs de staging, y sin despliegue automático a producción desde ese sitio.
4. Cargar la URL final en *Site URL* y *Redirect URLs* de Supabase.

---

## 6. Verificación antes de abrir al negocio

- [ ] Ingreso con cada rol (dueño, encargado, empleado) y con un usuario desactivado.
- [ ] El empleado no ve Dashboard, Configuración ni Auditoría y no puede anular (también probado contra la base).
- [ ] Alta de un producto de prueba, ingreso, salida, anulación y dashboard. Después **desactivar** ese producto (no se borra; queda en el historial) o hacer esta prueba solo en staging.
- [ ] Recuperar contraseña llega al email.
- [ ] Recargar una ruta interna (`/productos/…`) no da 404 (reescritura de rutas).
- [ ] En el navegador no aparece ninguna clave privilegiada (DevTools → fuentes / red).

---

## 7. Backups y recuperación

| Qué | Cómo | Cuándo |
|---|---|---|
| Backup automático | Diario, incluido en Supabase Pro. **El plan gratuito no lo tiene** | Solo con Pro |
| Backup manual semanal | `npx supabase@3.1.0 db dump --remote -f zahuy-esquema-AAAA-MM-DD.sql` y `npx supabase@3.1.0 db dump --remote --data-only -f zahuy-datos-AAAA-MM-DD.sql` (piden la contraseña de la base). Guardar en una carpeta privada (no el repo, no un chat), idealmente también en la nube del negocio | Una vez por semana mientras se use el plan gratuito |
| Backup manual | `npx supabase@3.1.0 db dump --remote -f <archivo>.sql` (esquema) y `--data-only` (datos), guardado **fuera del repo**, cifrado | Antes de cada migración en producción |
| Restaurar | Panel de Supabase → Backups (solo con Pro), o el backup manual en un proyecto nuevo siguiendo §7.1 | Solo ante pérdida de datos, con aprobación |

- Un rollback del frontend es volver a desplegar la versión anterior en Render (un clic).
- Un rollback de código **no** revierte una migración. Por eso las migraciones son aditivas (expandir-migrar-contraer) y se prueban antes en staging.
- Nunca `DROP`, `TRUNCATE` ni `DELETE` masivo en producción sin backup confirmado y aprobación.

### 7.1 Restaurar un backup manual (procedimiento probado)

Probado en la base local con datos ficticios (noviembre de 2026): se tomó la
huella, se hizo el backup, se recreó la base desde cero y se restauró. La huella
quedó idéntica, la base restaurada pasó todas las pruebas pgTAP y un usuario
restaurado pudo ingresar y operar. **Falta probarlo una vez en staging** antes de
depender de él.

**Al hacer cada backup** (además de los dos archivos de la tabla de arriba):

```bash
psql "<conexión de la base>" -q -At -f supabase/scripts/backup-fingerprint.sql > zahuy-huella-AAAA-MM-DD.txt
```

Guardar esa huella junto al backup. No contiene datos del negocio: solo
cantidades de filas y un resumen por tabla. La huella cubre **sola todas las
tablas** del esquema `public` (también las que se agreguen después, como ventas
y caja) más usuarios de Auth, Storage y las secuencias; no hay una lista que
mantener. Usar siempre `-q`: sin él, `psql` agrega una línea `SET` que ensucia la
comparación.

**Para restaurar en un proyecto nuevo** 🔒:

1. Crear el proyecto y aplicar las migraciones (`db push --remote`, §4). No cargar el seed.
2. Correr `supabase/scripts/restore-prepare.sql`. Quita las pocas filas que las
   migraciones crean solas (configuración general de alertas, su registro de
   auditoría y los buckets de Storage), que el backup trae con sus valores
   reales. Es **seguro por defecto**: toda tabla que no esté en su lista de
   tablas sembradas cuenta como datos del negocio, y si tiene filas (o hay
   usuarios o archivos) se detiene sin tocar nada y dice cuáles.
3. Cargar el archivo de datos: `psql "<conexión>" -f zahuy-datos-AAAA-MM-DD.sql`.
   Revisar que la salida no tenga ninguna línea `ERROR`.
4. Volver a correr `backup-fingerprint.sql` y comparar con la huella guardada:
   tienen que ser iguales, y `descuadres` tiene que ser 0.
5. Ingresar con un usuario real y revisar un producto y su historial.

**Por qué importa el paso 2.** Sin él, la restauración parece funcionar pero
pierde datos: en la prueba, la tabla de auditoría quedó con 1 fila en lugar de
37 y se perdieron las alertas por categoría. El archivo de datos carga cada
tabla en una sola sentencia; si una fila choca con otra que ya existe, esa tabla
entera no se carga y el resto sigue. Productos, lotes, movimientos y usuarios
sí se restauraban bien.

**Mantenerlo al día.** Cada PR que agregue una migración revisa esto:

| Si la migración... | Hay que... |
|---|---|
| Crea una tabla nueva | Nada: la huella y el paso previo la toman solas. Toda tabla de `public` necesita una columna `id` (contrato §2.5) |
| **Siembra filas** en una tabla (por ejemplo los medios de pago o las cajas de la propuesta de ventas) | Agregar esa tabla a `v_seeded` en `supabase/scripts/restore-prepare.sql`. Si se olvida, el paso previo se detiene y avisa (no se pierde nada en silencio) |
| Crea un bucket de Storage | Nada: el paso previo vacía los buckets (Storage tiene que estar vacío) |
| Agrega un esquema fuera de `public`, `auth` o `storage` con datos | Agregarlo a la huella y al paso previo, y probar el ciclo completo |

Además, probar el ciclo (huella → backup → recrear → paso previo → restaurar → huella igual) en la base local con datos ficticios cuando cambien los scripts o el esquema de forma importante. Detalle del último ciclo: base local, 17 productos, 25 lotes, 60 movimientos, 43 filas de auditoría y 5 usuarios: 0 errores y huella idéntica.

**Lo que el backup no trae:**

- **Las imágenes de productos.** El archivo de datos guarda qué imágenes
  existen, no los archivos. Si se usan imágenes, hay que copiarlas aparte desde
  Storage.
- **Las claves y la configuración del proyecto** (Auth, URLs, variables de
  Render): se cargan de nuevo a mano (§3 y §5).

**Detalles técnicos:**

- El archivo de datos restaura con los triggers desactivados
  (`session_replication_role = replica`), así que respeta las fechas y autores
  originales y no genera auditoría duplicada. Hay que cargarlo con un rol que
  pueda cambiar ese ajuste (el rol `postgres` del proyecto).
- Trae también los usuarios de Auth con su contraseña cifrada: después de
  restaurar, cada persona entra con su contraseña de siempre.
- La secuencia del SKU se restaura con su valor; además, la base saltea un SKU
  que ya exista, así que no se repiten.
- En la CLI 3.1.0, `--linked` sigue funcionando pero está marcado para
  eliminarse en la versión 4; el reemplazo es `--remote`.

## 8. Rutina para cada cambio posterior

1. PR con CI en verde (frontend y base).
2. Si trae migración, **el paso por staging es obligatorio y va primero** (no se salta, ni siquiera para un cambio "chico"):
   1. `db push --remote --dry-run` y `db push --remote` en **staging** (§3, proyecto vinculado a staging).
   2. Probar ahí: pruebas de la base, flujo manual con datos ficticios y, si la migración toca datos existentes, con filas previas (ver §7.1 para restaurar un estado de prueba).
   3. Anotar en el PR el resultado en staging (qué se aplicó, cuándo y quién).
   4. Recién entonces: backup manual de producción verificado (§7) → 🔒 `db push --remote` en producción → verificar conteos y relaciones.
3. Fusionar en `main` → Render publica el frontend. Si el cambio de frontend depende de la migración, la migración va antes.
4. Anotar en el PR qué se aplicó en producción y cuándo.

---

Fuentes de precios y condiciones (consultadas en noviembre de 2026; confirmar en las páginas oficiales al contratar):
[Supabase — guía de precios](https://uibakery.io/blog/supabase-pricing),
[Vercel Hobby y uso comercial](https://devtoolpick.com/guides/vercel-hobby-plan-commercial-use/),
[Render — precios](https://render-web.onrender.com/pricing).

---

## 9. Facturación electrónica ARCA (contrato §22)

**Estado (2026-11-23):** implementada y probada en **homologación** (sin validez fiscal). El **código de
producción está escrito** (direcciones de producción de WSAA y WSFEv1 y ambiente fijado por el secreto
`ARCA_ENVIRONMENT`), probado solo con simulaciones: **no se probó contra ARCA real ni está desplegado**. Sin
ese secreto la función trabaja en homologación y responde `501` si la configuración dice `produccion`. Pasar a
producción sigue siendo una decisión aparte (§9.3). Sin datos del titular en este documento: viven en secretos de Supabase, en la base y en la
carpeta privada del titular.

### 9.1 Procedimiento en un proyecto (hecho en staging el 2026-11-17)

1. **Migraciones**: `npx supabase db push --remote --dry-run` y, si lista solo lo esperado, `--yes`
   (tablas `fiscal_*`, `private.fiscal_tickets`, `fiscal_begin`/`fiscal_finish`/`fiscal_claim`, datos del
   emisor). Con el ambiente fiscal en `off` (valor por defecto) la caja no cambia.
2. 🔒 **Secretos de la función** (certificado y clave **de homologación**; la clave nunca se imprime ni se
   sube): `npx supabase secrets set --env-file <archivo fuera del repo>` con `ARCA_CUIT`, `ARCA_CERT_PEM` y
   `ARCA_KEY_PEM` (PEM en una línea con `\n` literales). `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase.
3. 🔒 **Desplegar**: `npx supabase functions deploy arca-emitir --use-api` (`verify_jwt = true` en
   `supabase/config.toml`).
4. **Configurar desde la app** (usuario dueño o programador): Configuración → Facturación electrónica →
   ambiente «Prueba (homologación)», punto de venta y datos del emisor (razón social, CUIT, domicilio,
   Ingresos Brutos, inicio de actividades). Producción no se activa desde la app.
5. **Verificar con ventas ficticias**: factura de consumidor final, repetirla (mismo comprobante), una venta
   cobrada con redondeo (la factura sale por lo cobrado), nota de crédito y anulación recién después; que la
   empleada vea solo sus comprobantes; que ninguna respuesta lleve token ni firma.
6. Al terminar, dejar el proyecto con la facturación en `off` y sin datos del emisor si es un ambiente de
   pruebas.

Notas operativas: ARCA **no entrega otro ticket de acceso mientras el anterior siga vigente** (unas 12 h); la
función lo guarda en la base, y si ARCA ya entregó uno que no está guardado responde `503`
(`TICKET_UNAVAILABLE`) hasta que venza. Cada proyecto de Supabase tiene su propia función, sus secretos y su
configuración: un frontend solo factura contra el proyecto al que apunta.

### 9.2 Qué no hacer

- **No desplegar la función de homologación en el proyecto de producción.** Crearía comprobantes de prueba
  pegados a ventas reales. Mientras no se dé la orden de producción, el negocio sigue con el ticket
  interno (y «Guardar sin ticket») y su sistema actual de facturación.
- No cargar certificados, claves ni el CUIT del titular en el repositorio, en chats ni en esta carpeta.

### 9.3 Pasar a producción: lista de verificación (todo 🔒)

Hecho: el contador respondió todas las preguntas (§22.7); el certificado de producción está emitido y el
servicio de facturación de producción está autorizado en ARCA (guardados fuera del repositorio).

Falta, en este orden:

- [ ] **Orden explícita del dueño** de pasar a producción, con fecha.
- [ ] **Backup verificado** de la base de producción (§7) y migraciones aplicadas primero en staging.
- [ ] **PR de código** con las direcciones de producción de WSAA y WSFEv1 y el ambiente fijado por
  `ARCA_ENVIRONMENT` (escrito, pendiente de revisión de `efacelli` y del contador; no se fusiona hasta la
  orden del dueño). La base ya exige, para pasar a `produccion`, un comprobante autorizado antes en homologación
  (`PRODUCTION_NOT_READY`).
- [ ] **Secretos de producción** (`ARCA_CUIT`, certificado y clave de producción y
  `ARCA_ENVIRONMENT=produccion`) cargados en el proyecto de producción y la función desplegada ahí.
- [ ] **Piloto en una caja** (el contador acepta una o las dos) y revisión del primer comprobante: consulta a
  ARCA y lectura del QR con la app de ARCA, e impresión en el papel real (térmica o A4).
- [ ] **Punto de venta aparte para contingencia (CAEA)**, si el comercio lo quiere: hoy no está
  implementada.
- [ ] **Reversión**: poner el ambiente en `off` (la caja sigue vendiendo) y corregir lo emitido con notas de
  crédito; los comprobantes no se borran.
