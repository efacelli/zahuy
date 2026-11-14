---
description: Implementar reglas de productos, lotes, vencimientos, stock
  y movimientos sin inconsistencias ni dobles descuentos.
name: inventory-domain
---

# Inventory Domain Workflow

-   Mantener una única fuente de verdad del stock y documentarla.
-   Los movimientos son historial auditable; no borrar ni editar
    silenciosamente movimientos confirmados.
-   Cada movimiento registra producto, lote si aplica, cantidad
    positiva, tipo, fecha, usuario y motivo.
-   Validar que una salida no deje stock negativo.
-   Garantizar atomicidad, concurrencia e idempotencia.
-   Un producto puede tener múltiples lotes y vencimientos.
-   Productos no perecederos pueden carecer de vencimiento; lotes
    agotados no generan alertas.
-   Distinguir vencido, por vencer, agotado y sin vencimiento.
-   Alertas iniciales: 30, 15 y 7 días; evitar duplicados.
-   SKU obligatorio y único; proveedor opcional; cajas manuales e
    independientes de unidades.
-   Código de barras opcional, fuera del alcance inicial.
-   Probar SKU duplicado, cantidades inválidas, lote agotado,
    concurrencia y correcciones compensatorias. No implementar ventas ni
    descuentos hasta aprobación de esa etapa.
