---
description: Investigar y diseñar la futura integración ARCA
  WSAA/WSFEv1, certificados, CAE y contingencias sin emitir comprobantes
  reales.
name: arca-invoicing
---

# ARCA Integration --- futuro, requiere aprobación

1.  Consultar documentación oficial vigente de ARCA.
2.  Relevar titular/CUIT, condición fiscal, punto de venta y
    comprobantes A/B/C con el contador.
3.  Confirmar servicio autorizado, certificado, renovación y
    credenciales WSAA.
4.  Separar homologación y producción.
5.  Llamar servicios fiscales solo desde backend seguro.
6.  Proteger claves privadas y tickets.
7.  Persistir request/response, CAE, vencimiento, punto de venta, número
    y estado.
8.  Implementar idempotencia, conciliación y manejo de rechazos.
9.  Distinguir borrador, pendiente, rechazado, autorizado y
    contingencia.
10. Investigar CAEA y plazos vigentes; no asumir reglas.
11. No emitir comprobantes reales en pruebas.
12. Exigir aprobación explícita antes de producción. Esta guía no
    reemplaza asesoramiento contable ni autorización del contribuyente.
