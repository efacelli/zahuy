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

## Datos y usuarios de prueba (seed)

`npx supabase@3.1.0 db reset` carga `supabase/seed.sql`: datos **ficticios**
(5 categorías, 5 marcas, 2 proveedores, 12 productos con lotes vencidos, por
vencer y vigentes, y movimientos de ejemplo) y cuatro usuarios:

| Email | Rol |
|---|---|
| `duena@zahuy.test` | Dueña (`admin`) |
| `encargado@zahuy.test` | Encargado (`manager`) |
| `empleada@zahuy.test` | Empleada (`staff`) |
| `inactivo@zahuy.test` | Usuario desactivado |

**Los usuarios se crean sin contraseña**, para que no haya ninguna credencial en
el repositorio (que es público). Después de cada `db reset`, cada persona les
pone una en su máquina, eligiendo la clave en el momento:

```bash
docker exec -i supabase_db_zahuy psql -U postgres -v pw="ELEGI_UNA_CLAVE" -c "update auth.users set encrypted_password = extensions.crypt(:'pw', extensions.gen_salt('bf')) where email like '%@zahuy.test'"
```

Esa clave vale solo en la base local y se pierde con el próximo `db reset`.
No usar una contraseña real ni reutilizada.

- El seed usa las mismas RPC que la app, con claves de idempotencia fijas:
  correrlo dos veces no duplica nada.
- Las fechas son relativas a hoy, así siempre hay lotes vencidos, urgentes y
  próximos a vencer.
- Para arrancar sin datos: `npx supabase@3.1.0 db reset --no-seed`.
- Las pruebas (`test db`) pasan con o sin el seed cargado.
- El seed solo se aplica en local. No correrlo contra un proyecto en la nube.

## Reglas

- Migraciones nuevas y versionadas en `supabase/migrations/`; nunca se edita una
  migración ya aplicada en un ambiente compartido. Nada destructivo.
- Solo datos ficticios en `seed.sql` y en las pruebas.
- No se suben `.env`, claves, dumps ni backups.
- `src/types/database.ts` se genera con
  `npx supabase@3.1.0 gen types typescript --local`; no se edita a mano.
