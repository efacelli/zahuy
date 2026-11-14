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
