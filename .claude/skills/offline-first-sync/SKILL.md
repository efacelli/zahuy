---
description: Diseñar PWA, IndexedDB, cola de operaciones offline y
  sincronización segura con Supabase entre dispositivos.
name: offline-first-sync
---

# Offline-first Workflow --- solo etapa aprobada

1.  Definir pantallas y operaciones que deben funcionar sin red.
2.  Separar caché de lectura de operaciones pendientes.
3.  Evaluar Service Worker para recursos e IndexedDB para datos/cola
    local.
4.  Cada operación offline tendrá UUID/idempotency key, fecha,
    dispositivo/usuario, versión del payload y estado.
5.  Reintentos con backoff, deduplicación y estados visibles.
6.  No usar last-write-wins para conflictos de stock.
7.  Definir reconciliación de movimientos concurrentes entre
    cajas/dispositivos.
8.  Probar cortes, reconexión, cierre de navegador, recarga, reintentos
    y conflictos.
9.  Separar guardado local, sincronización Supabase y autorización
    fiscal.
10. Una venta guardada localmente no es una factura autorizada.
    Presentar modelo de consistencia y riesgos antes de habilitar
    producción.
