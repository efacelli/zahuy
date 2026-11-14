---
description: Diseñar y modificar el esquema Supabase/PostgreSQL con
  migraciones seguras, constraints, índices y operaciones
  transaccionales.
name: supabase-database
---

# Supabase Database Workflow

1.  Inspeccionar esquema, migraciones y versión CLI antes de actuar.
2.  Evitar tablas duplicadas y respetar el modelo del proyecto.
3.  Para cada cambio explicar columnas, nulabilidad, defaults,
    constraints, índices y compatibilidad.
4.  Crear migraciones nuevas; nunca reescribir migraciones aplicadas en
    ambientes compartidos.
5.  Preferir cambios compatibles hacia atrás y expandir-migrar-contraer.
6.  Operaciones multi-tabla de stock mediante transacción o RPC; no
    escrituras frontend separadas.
7.  Validaciones críticas también en PostgreSQL.
8.  Probar en DB descartable con datos representativos.
9.  Verificar conteos, relaciones y consultas.
10. No ejecutar reset/drop/truncate/delete masivo en datos reales.
    Exigir aprobación y backup verificado. Entregar migración,
    explicación, pruebas y estrategia de recuperación.
