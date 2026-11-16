# Base de datos (Supabase)

Responsable: backend. Todo lo de esta carpeta sigue `docs/DATA_CONTRACT.md`;
si el contrato y una migración difieren, se corrige por Pull Request antes de
tocar el esquema.

## Requisitos

- Docker Desktop en ejecución (en Windows necesita WSL 2).
- Node 24 (la misma versión que usa el CI).
- Supabase CLI **3.1.0**, siempre con la versión fija y sin instalación global:

  ```bash
  npx supabase@3.1.0 <comando>
  ```

  Para cambiar de versión: actualizar este número en un PR propio y volver a
  correr todas las pruebas de base.

## Uso local

```bash
npx supabase@3.1.0 start      # levanta la base, Auth, Storage y Studio en Docker
npx supabase@3.1.0 status     # muestra la URL y la clave pública local
npx supabase@3.1.0 db reset   # recrea la base LOCAL: migraciones + seed ficticio
npx supabase@3.1.0 test db    # corre las pruebas pgTAP de supabase/tests/
npx supabase@3.1.0 stop
```

`db reset` borra y recrea la base **local**. Nunca se ejecuta contra un proyecto
en la nube.

Para el frontend: copiar `.env.example` como `.env.local` y completar
`VITE_SUPABASE_PUBLISHABLE_KEY` con la clave **pública** que muestra `status`.
La clave `service_role` / `sb_secret_...` no se copia a ningún archivo del
repositorio.

## Configuración de Auth (`config.toml`)

| Ajuste | Valor | Motivo |
|---|---|---|
| `auth.enable_signup` | `false` | No hay registro público: los usuarios los crea el administrador |
| `auth.enable_anonymous_sign_ins` | `false` | Sin sesiones anónimas |
| `auth.email.enable_confirmations` | `false` | El administrador crea usuarios ya confirmados |
| `auth.site_url` | `http://localhost:5173` | Puerto de `npm run dev` |

`config.toml` solo gobierna el entorno **local**. Cuando exista un proyecto en
la nube, estos ajustes hay que repetirlos ahí a mano, con aprobación explícita.

## Permisos: nada queda expuesto por defecto

La primera migración quita los permisos que Supabase otorga por defecto a
`anon` y `authenticated` sobre los objetos nuevos del esquema `public`. Cada
migración que crea una tabla, vista o función tiene que:

1. activar RLS en la tabla y crear sus políticas;
2. otorgar con `GRANT` solo lo que indica el contrato (por columna cuando
   corresponde);
3. en las funciones, `REVOKE ALL ... FROM PUBLIC` y `GRANT EXECUTE` solo a
   `authenticated`.

Las funciones auxiliares viven en el esquema `private`, que no está expuesto
por la API. Las pruebas verifican que ninguna tabla de `public` quede sin RLS y
que `anon` no pueda ejecutar ninguna función.

## Usuarios y primer administrador

- No hay registro público. Los usuarios se crean desde el panel de Supabase
  (Authentication → Users) o con la API de administración.
- Al crear un usuario, un trigger le crea su fila en `public.profiles` con rol
  `staff`. El nombre sale de `full_name` en los metadatos o, si falta, del
  email. El rol nunca se toma de los metadatos.
- **Primer administrador:** se promueve una única vez por SQL, con un rol
  privilegiado (editor SQL del proyecto, o `psql` en local):

  ```sql
  update public.profiles
  set role = 'admin'
  where id = (select id from auth.users where email = 'EMAIL_DEL_ADMIN');
  ```

  Después de eso, los cambios de rol y de estado los hace un `admin` desde la
  app. Un admin no puede quitarse el rol ni desactivarse a sí mismo.
- Para dar de baja a alguien se usa `is_active = false`; los usuarios no se
  borran, porque los movimientos conservan quién los hizo.

## Pruebas de la base

Antes de cada Pull Request que toque `supabase/`, desde la raíz del repo:

```bash
npx supabase@3.1.0 db reset
```

```bash
npx supabase@3.1.0 test db
```

```bash
npm run check
```

- **pgTAP** (`supabase/tests/*.test.sql`): cada archivo corre en una transacción
  que se revierte, con datos ficticios propios. Pasan con o sin el seed.
- **`14_security_matrix.test.sql`** revisa todo el esquema: RLS en cada tabla,
  `security_invoker` en cada vista, `SECURITY DEFINER` con `search_path` vacío
  en cada función, nada accesible para `anon` y la matriz de permisos de §9.
  **Al agregar una tabla nueva hay que sumarla a esa matriz**, o la prueba falla.
- **Concurrencia** (`supabase/scripts/concurrency-test.mjs`): pgTAP usa una sola
  sesión, así que los pedidos simultáneos se prueban por la API. Después de
  `db reset` y `npm run db:users` (y de esperar unos segundos a que la API
  termine de levantar):

  ```bash
  node supabase/scripts/concurrency-test.mjs
  ```

  Lee `.env.local` y `.env.test.local`, solo acepta una URL local y deja
  movimientos ficticios (el ledger no se borra): correr `db reset` al terminar.
- **Concurrencia de ventas y caja** (`supabase/scripts/concurrency-sales-test.mjs`): igual
  que la anterior (mismo usuario `encargado@zahuy.test`, solo local). Cubre ventas
  simultáneas sobre un lote, la misma venta reenviada en paralelo, anulaciones
  simultáneas, ventas contra el cierre de caja y ventas con productos en orden opuesto:

  ```bash
  node supabase/scripts/concurrency-sales-test.mjs
  ```
- **Migración sobre datos existentes:** antes de subir una migración, aplicarla
  con `npx supabase@3.1.0 migration up` sobre la base local con el seed cargado
  y comparar conteos antes y después. Una migración nunca borra ni reescribe
  datos; si encuentra datos incompatibles tiene que fallar con un mensaje claro.
- Después de una migración que cambie tablas, vistas, funciones o enums de
  `public`: `npm run gen:types`. Si el cambio agrega un valor a un enum que el frontend
  también declara (por ejemplo `movement_type`), `src/types/contract-check.ts` falla hasta que
  `efacelli` actualice `src/domain`: coordinarlo antes de subir el tipo generado.

El CI corre `db start` y `test db` en cada Pull Request (job "Base de datos (migraciones y pgTAP)"). La prueba de concurrencia no corre en el CI: necesita los usuarios de prueba.

## Reglas

- Migraciones nuevas y versionadas en `supabase/migrations/`; nunca se edita una
  migración ya aplicada en un ambiente compartido. Nada destructivo.
- Solo datos ficticios en `seed.sql` y en las pruebas.
- No se suben `.env`, claves, dumps ni backups.
- `src/types/database.ts` se genera con
  `npx supabase@3.1.0 gen types typescript --local`; no se edita a mano.
