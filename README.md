# Kit Claude Code --- supermercado

Copiar `CLAUDE.md` y la carpeta `.claude/` a la raíz del repositorio.

Incluye seis skills: - `supabase-database`: esquema y migraciones. -
`inventory-domain`: productos, lotes, stock y vencimientos. -
`offline-first-sync`: modo offline y sincronización (futuro). -
`security-rls`: autenticación, RLS y secretos. - `testing-migrations`:
regresión y protección de datos. - `arca-invoicing`: investigación
fiscal e integración ARCA (futuro).

Las skills son instrucciones especializadas, no librerías ni permisos
automáticos. Claude Code carga el nombre y descripción y puede
invocarlas según la tarea; también se pueden llamar como
`/nombre-de-la-skill`.
