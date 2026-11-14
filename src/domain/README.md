# `src/domain`

Valores y etiquetas de los enums del contrato (`docs/DATA_CONTRACT.md`, §4)
para usar en la interfaz: textos en español, íconos, niveles de alerta y
validaciones de formulario que **repiten** (no reemplazan) las de la base.

- Las reglas de negocio viven en PostgreSQL. Acá solo hay lo necesario para
  mostrar y para validar antes de enviar.
- Los valores deben coincidir exactamente con el contrato. Cuando el backend
  publique `src/types/database.ts`, se agrega una verificación de tipos que falla
  en compilación si un enum de acá no coincide con el generado.
- El estado de vencimiento (`expiry_status`) **no** se calcula en el frontend:
  viene de la vista `v_batch_status`. Acá solo se traduce a nivel de alerta.
