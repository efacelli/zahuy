# CLAUDE.md --- Sistema de gestión del supermercado

## Misión

Aplicación web privada para un supermercado concreto. La primera etapa
cubre productos, lotes, vencimientos, stock y movimientos. Las etapas
futuras podrán incluir compras, precios, ventas, caja, facturación ARCA,
clientes, cuentas corrientes y modo offline.

La integridad, trazabilidad, seguridad y recuperación de datos tienen
prioridad sobre la velocidad de desarrollo.

## Contrato de datos y responsables

-   `docs/DATA_CONTRACT.md` es la estructura compartida de tablas,
    columnas, tipos, vistas, RPC y códigos de error. Leerlo antes de
    tocar esquema, tipos o consultas. No inventar nombres ni tipos que
    no estén ahí; si falta algo, proponer el cambio en el contrato por
    PR antes de implementarlo.
-   Frontend (`src/`): `efacelli`. Backend (`supabase/`): colega.
    No editar el área del otro sin acordarlo.
-   `efacelli` aprueba y fusiona los Pull Request.

## Reglas críticas

-   Nunca borrar, recrear, truncar ni sobrescribir tablas o registros
    reales para agregar funciones.
-   Toda modificación de esquema se realiza mediante migraciones SQL
    versionadas, revisables y probadas.
-   Nunca ejecutar migraciones destructivas en producción.
-   Antes de cambios de riesgo, explicar impacto, backup, despliegue y
    recuperación; pedir aprobación humana.
-   No usar datos reales en pruebas; usar datos ficticios o copias
    anonimizadas.
-   No desplegar, modificar producción, cambiar credenciales ni ejecutar
    operaciones irreversibles sin autorización explícita.
-   No afirmar que algo funciona sin ejecutar pruebas y reportar
    resultados.
-   Nunca guardar secretos en Git, frontend, logs o documentación.
-   Nunca exponer la Supabase `service_role` key en el navegador.
-   Si una regla comercial, fiscal o de inventario no está definida,
    preguntar en lugar de inventarla.
-   No implementar ventas, caja ni ARCA en la primera etapa salvo pedido
    explícito. El lector USB de códigos de barras se adelantó a pedido de
    `efacelli` (ver Productos).

## Stack previsto

-   React + Vite + TypeScript.
-   Supabase PostgreSQL y Supabase Auth.
-   Row Level Security (RLS) en todas las tablas expuestas.
-   Vercel o Render para frontend, a definir.
-   GitHub (repositorio público por decisión del equipo: nunca subir
    secretos, datos del negocio ni datos personales).
-   CSS convencional/modular; no introducir Tailwind sin aprobación.
-   No agregar Node/Express inicialmente. Evaluar Edge Functions/backend
    solo si se necesita lógica privilegiada o integración segura.
    Inspeccionar el proyecto y versiones actuales antes de instalar,
    actualizar o reemplazar dependencias.

## Forma de trabajo

1.  Inspeccionar repositorio, estructura, scripts, migraciones y estado
    Git.
2.  Resumir comprensión y proponer un plan acotado.
3.  Identificar pantallas, tablas, flujos y pruebas afectadas.
4.  Implementar en cambios pequeños.
5.  Agregar o actualizar pruebas.
6.  Ejecutar lint, typecheck, tests y build disponibles.
7.  Revisar `git diff`.
8.  Informar archivos, migraciones, pruebas, resultados y riesgos. Si la
    tarea es amplia, planificar primero y esperar aprobación antes de
    cambios grandes.

## Etapa 1: alcance funcional

### Productos

-   SKU obligatorio y único, generado por la base (6 dígitos).
-   Código de barras opcional. Lector USB (funciona como teclado: números
    + Enter): escanear fuera de un campo abre el producto; en los buscadores
    de los diálogos elige el producto; en el alta completa el código. La
    lectura por cámara y los códigos de balanza (peso o precio dentro del
    código) quedan para una etapa futura.
-   Nombre obligatorio; descripción opcional.
-   Marca y categoría.
-   Proveedor opcional.
-   Unidad de venta.
-   Costo y precio de venta, ambos sin IVA; el precio final con IVA lo
    calcula la base.
-   IVA seleccionable: 21% o 10,5%.
-   Stock actual con una única fuente de verdad.
-   Cantidad de cajas cerradas en depósito: conteo manual. Las unidades de
    esas cajas forman parte del stock (no son un segundo stock); con las
    unidades por caja (12 por defecto) se muestra el desglose sueltas +
    cajas. Ver `docs/DATA_CONTRACT.md` §3 y §7.2.
-   Stock mínimo configurable.
-   Estado activo/inactivo e imagen opcional.

### Lotes y vencimientos

-   Un producto puede tener múltiples lotes.
-   Lote: número opcional, fecha de ingreso, vencimiento, cantidad
    inicial/disponible y observaciones.
-   Todos los productos se controlan por vencimiento (también limpieza y
    bazar): la fecha es obligatoria al cargar stock.
-   Cantidad disponible coherente con movimientos.
-   Las salidas descuentan automáticamente del lote que vence primero.
-   No alertar por lotes agotados.
-   Alertas: 30, 15 y 7 días por defecto, configurables por categoría,
    además de vencidos.
-   Distinguir por vencer, vencido, agotado y sin vencimiento.

### Movimientos

-   Entradas, salidas, ajustes, mermas, daños, devoluciones y consumo interno.
-   Registrar producto, lote cuando corresponda, tipo, cantidad, fecha,
    usuario y motivo.
-   No permitir stock negativo salvo aprobación explícita de una regla
    futura.
-   No editar silenciosamente historial confirmado: corregir mediante
    movimientos compensatorios auditables.
-   Operaciones atómicas y protegidas contra duplicados/reintentos.
-   Preparar el dominio para futuras ventas que descuenten stock una
    sola vez.

### Listado y dashboard

-   SKU, nombre, marca, categoría, proveedor, costo, precio, IVA, stock,
    cajas, próximo vencimiento y estado.
-   Búsqueda, filtros por proveedor/categoría/stock
    bajo/vencimiento/estado, orden y paginación.
-   Estados vacíos, carga y error.
-   Métricas calculadas desde datos reales, sin duplicar reglas de
    negocio.

## Etapas futuras --- no implementar todavía

1.  Proveedores, compras, recepción y costos reales.
2.  Márgenes y aumentos por marca/proveedor.
3.  Descuentos por cantidad configurables. Ejemplo conversado: cada 6
    unidades = 5%, cada 12 = 10%, cada 18 = 15%. Regla editable; en el
    carrito el empleado puede modificar o quitar el descuento sugerido.
    No asumir que aplica a todos los productos.
4.  Clientes, cuentas corrientes, deuda y bloqueo de cuenta.
5.  Ventas, caja y tickets/PDF (el lector USB ya está; la venta lo usará).
6.  Facturación ARCA A/B/C, WSAA, WSFEv1, certificados y contingencia
    según normativa vigente.
7.  PWA/offline, almacenamiento local y sincronización
    multi-dispositivo.
8.  Reportes y automatizaciones.

## Modelo de datos inicial sugerido

`profiles`, `categories`, `brands`, `suppliers`, `products`,
`product_batches`, `stock_movements`. Inspeccionar primero el esquema
existente. Usar UUID, claves foráneas, restricciones, índices y
validaciones. SKU debe ser único. Definir y documentar una sola fuente
de verdad del stock. Las operaciones que actualicen varias tablas o
saldos deben ejecutarse en transacción o función PostgreSQL/RPC. Usar
idempotencia para evitar movimientos duplicados.

## Seguridad

-   Activar RLS en todas las tablas expuestas por Supabase.
-   Mínimo privilegio por rol.
-   No confiar en controles de React para autorizar operaciones.
-   Repetir validaciones críticas en DB/backend.
-   Nunca permitir que el usuario se asigne roles desde el cliente.
-   Secretos solo en entornos seguros; no incluir service role key,
    claves fiscales ni certificados privados en frontend.
-   Validar entradas, proteger Storage y auditar operaciones relevantes.
-   Probar acceso permitido y denegado por rol.
-   No registrar contraseñas, tokens, claves fiscales ni datos
    sensibles.

## Migraciones y protección de datos

-   Migraciones append-only en ambientes compartidos; no reescribir
    migraciones aplicadas.
-   Preferir expandir-migrar-contraer: agregar estructuras compatibles,
    desplegar código, completar datos, validar y retirar lo obsoleto
    mucho después con aprobación.
-   Para columnas nuevas, definir NULL/default y comportamiento de filas
    antiguas.
-   No agregar NOT NULL sin backfill y validación.
-   No cambiar tipos/nombres/restricciones en uso sin plan de
    transición.
-   Probar migraciones en DB descartable con datos de prueba.
-   Antes de producción: backup verificado, revisión SQL, plan de
    recuperación y ventana de mantenimiento si aplica.
-   Un rollback de código no revierte necesariamente una migración.
-   Verificar conteos y relaciones antes/después.
-   Nunca ejecutar DROP, TRUNCATE o DELETE masivo en datos reales sin
    aprobación y backup confirmado.

## Offline --- futuro

No implementar hasta aprobación, pero evitar decisiones que lo
imposibiliten. Cuando se habilite, evaluar PWA, Service Worker e
IndexedDB; persistir una cola local de operaciones con UUID/idempotency
key, usuario/dispositivo, timestamp, versión de payload y estado.
Mostrar pendiente, sincronizando, sincronizado o requiere revisión.
Reintentos seguros, deduplicación y resolución explícita de conflictos.
Nunca usar last-write-wins para stock. Separar guardado local,
sincronización Supabase y autorización fiscal ARCA. Una operación
offline no equivale a factura autorizada.

## ARCA --- futuro

Mantener fuera de la etapa inicial. Antes de implementar, verificar
documentación oficial vigente y consultar al contador. Relevar
titular/CUIT, condición fiscal, punto de venta, comprobantes A/B/C,
permisos, certificado, WSAA, WSFEv1 y contingencia/CAEA aplicable.
Probar en homologación. Llamadas solo desde backend seguro. Nunca
exponer claves privadas ni tickets en React. Persistir solicitudes,
respuestas, CAE, vencimiento, punto de venta, número y estado.
Idempotencia y conciliación para evitar duplicados. No considerar
autorizado un comprobante sin respuesta afirmativa de ARCA.

## UI

Interfaz profesional y rápida para empleados, priorizando
escritorio/tablet. Navegación clara, formularios agrupados,
validaciones, confirmación de acciones que afectan stock y mensajes
accionables. Accesibilidad: no depender solo del color. Mantener
componentes reutilizables y no duplicar lógica de negocio en UI.

## Pruebas obligatorias

-   SKU duplicado; cantidades cero/negativas; stock insuficiente; lote
    agotado; producto sin vencimiento; vencimiento pasado.
-   Integridad de lotes y movimientos; concurrencia/reintentos si
    corresponde.
-   RLS con usuario autorizado y no autorizado.
-   Migraciones con registros preexistentes y comprobación de que
    permanecen disponibles.
-   Flujos de error y build de producción. Si no se pudo ejecutar una
    prueba, declararlo.

## Git y colaboración

Repositorio público (ver Stack). Cada integrante usa su propia cuenta. Ramas por
tarea, commits pequeños y Pull Requests. No trabajar simultáneamente
sobre los mismos archivos/rama. No subir `.env`, secretos, certificados,
dumps reales ni temporales. No hacer deploy sin aprobación.

## Informe al terminar

Informar: qué se implementó, archivos modificados, migraciones, pruebas
ejecutadas/resultados, pendientes y riesgos. Ante riesgo de pérdida de
datos, vulnerabilidad, cambio fiscal o acción irreversible, detenerse y
pedir autorización.


## Contrato de datos obligatorio

El archivo `docs/DATA_CONTRACT.md` es la fuente oficial de verdad para todos los nombres de tablas, campos, tipos de datos, relaciones y convenciones del proyecto.

Reglas obligatorias:

1. Antes de crear o modificar funcionalidades, leer `docs/DATA_CONTRACT.md`.
2. No inventar, renombrar ni modificar campos por decisión propia.
3. El frontend debe utilizar exactamente los nombres y tipos definidos en el contrato.
4. El backend debe crear las tablas y columnas respetando exactamente el contrato.
5. Si una funcionalidad necesita un campo nuevo, proponer el cambio y documentarlo antes de implementarlo.
6. Ningún integrante puede cambiar unilateralmente el contrato.
7. Toda modificación debe quedar versionada en GitHub.
8. Las modificaciones de base de datos deben realizarse mediante migraciones SQL seguras y revisables.

Ante cualquier contradicción entre el código y el contrato, detenerse y solicitar revisión antes de continuar.