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

## Reglas

- Migraciones nuevas y versionadas en `supabase/migrations/`; nunca se edita una
  migración ya aplicada en un ambiente compartido. Nada destructivo.
- Solo datos ficticios en `seed.sql` y en las pruebas.
- No se suben `.env`, claves, dumps ni backups.
- `src/types/database.ts` se genera con
  `npx supabase@3.1.0 gen types typescript --local`; no se edita a mano.
