---
description: Crear pruebas de regresión y validar migraciones para
  conservar productos, lotes, stock y datos existentes.
name: testing-migrations
---

# Regression and Migration Testing

-   Inspeccionar scripts de test, lint, typecheck y build.
-   Usar fixtures ficticios; nunca datos reales sin anonimizar.
-   Registrar invariantes: SKU único, relaciones válidas, stock no
    negativo, lotes coherentes, movimientos auditables.
-   Ejecutar migraciones en DB descartable con datos previos.
-   Confirmar que filas y relaciones existentes se conservan.
-   Verificar NULL/default para filas antiguas.
-   Probar flujos principales, errores, RLS y concurrencia según
    alcance.
-   Revisar diff por cambios accidentales.
-   No asumir que rollback de código revierte DB. No declarar terminado
    si una prueba crítica no se ejecutó.
