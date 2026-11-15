# Zahuy — Sistema de gestión del supermercado

Aplicación web privada: productos, lotes, vencimientos, stock y movimientos
(Etapa 1). Reglas del proyecto en [`CLAUDE.md`](CLAUDE.md); estructura de datos
compartida en [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

| Área | Carpeta | Responsable |
|---|---|---|
| Frontend (React + Vite + TypeScript) | `src/` | `efacelli` |
| Backend (Supabase: migraciones, RLS, RPC) | `supabase/` | colega |

## Frontend: puesta en marcha

Requisitos: Node 24 o superior.

```bash
npm install
cp .env.example .env.local   # completar URL y clave PÚBLICA de Supabase
npm run dev
```

En `.env.local` va solo la clave pública (publishable/anon). La app se niega a
arrancar si detecta una `service_role` o una clave secreta.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en http://localhost:5173 |
| `npm run lint` | Lint (oxlint) |
| `npm run typecheck` | Verificación de tipos |
| `npm run test` | Pruebas (Vitest + Testing Library) |
| `npm run build` | Build de producción en `dist/` |
| `npm run check` | Todo lo anterior, en orden |

## Base local (Supabase + Docker)

Requisitos: Docker Desktop abierto.

```bash
npx supabase@3.1.0 start      # levanta la base local (127.0.0.1:54321)
npx supabase@3.1.0 db reset   # aplica migraciones y carga supabase/seed.sql (BORRA la base LOCAL)
npm run db:users              # crea encargado@, empleado@ y duena@zahuy.test
```

- `supabase/seed.sql` carga datos **ficticios** de demostración, con vencimientos
  relativos a hoy (hay lotes vencidos, urgentes y por vencer).
- `npm run db:users` toma la contraseña de `TEST_USER_PASSWORD` en
  `.env.test.local` (no se sube a Git; creala con una contraseña de prueba
  cualquiera). Solo funciona contra la base local.
- `npx supabase@3.1.0 test db` corre las pruebas de la base (pgTAP).
- `npm run gen:types` regenera `src/types/database.ts` desde la base local;
  hacerlo después de cada migración. `src/types/contract-check.ts` hace fallar
  `tsc` si los enums del frontend dejan de coincidir con los de la base.

## Skills de Claude Code (`.claude/skills/`)

- `supabase-database`: esquema y migraciones.
- `inventory-domain`: productos, lotes, stock y vencimientos.
- `security-rls`: autenticación, RLS y secretos.
- `testing-migrations`: regresión y protección de datos.
- `offline-first-sync`: modo offline y sincronización (futuro).
- `arca-invoicing`: investigación fiscal e integración ARCA (futuro).

Las skills son instrucciones especializadas, no librerías ni permisos
automáticos. Claude Code las usa según la tarea; también se pueden llamar como
`/nombre-de-la-skill`.
