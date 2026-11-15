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
npx supabase@3.1.0 db push --dry-run                        # lista lo que se va a aplicar; revisar
npx supabase@3.1.0 db push                                  # aplica las migraciones pendientes
```

- **Nunca** cargar `supabase/seed.sql` en producción (es solo para la base local; `db push` no lo aplica).
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
3. Despliegue automático desde `main` **después** de que pase el CI. Un sitio estático aparte para staging es opcional.
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
| Backup manual semanal | `npx supabase@3.1.0 db dump --linked -f zahuy-esquema-AAAA-MM-DD.sql` y `npx supabase@3.1.0 db dump --linked --data-only -f zahuy-datos-AAAA-MM-DD.sql` (piden la contraseña de la base). Guardar en una carpeta privada (no el repo, no un chat), idealmente también en la nube del negocio | Una vez por semana mientras se use el plan gratuito |
| Backup manual | `npx supabase@3.1.0 db dump --linked -f <archivo>.sql` (esquema) y `--data-only` (datos), guardado **fuera del repo**, cifrado | Antes de cada migración en producción |
| Restaurar | Panel de Supabase → Backups, o el dump manual en un proyecto nuevo | Solo ante pérdida de datos, con aprobación |

- Un rollback del frontend es volver a desplegar la versión anterior en Render (un clic).
- Un rollback de código **no** revierte una migración. Por eso las migraciones son aditivas (expandir-migrar-contraer) y se prueban antes en staging.
- Nunca `DROP`, `TRUNCATE` ni `DELETE` masivo en producción sin backup confirmado y aprobación.

## 8. Rutina para cada cambio posterior

1. PR con CI en verde (frontend y base).
2. Si trae migración: `db push` en staging → probar → backup manual de producción → 🔒 `db push` en producción → verificar conteos.
3. Fusionar en `main` → Render publica el frontend.
4. Anotar en el PR qué se aplicó y cuándo.

---

Fuentes de precios y condiciones (consultadas en noviembre de 2026; confirmar en las páginas oficiales al contratar):
[Supabase — guía de precios](https://uibakery.io/blog/supabase-pricing),
[Vercel Hobby y uso comercial](https://devtoolpick.com/guides/vercel-hobby-plan-commercial-use/),
[Render — precios](https://render-web.onrender.com/pricing).
