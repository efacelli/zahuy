---
description: Auditar autenticación, autorización, políticas RLS,
  secretos, permisos y exposición de datos en Supabase y React.
name: security-rls
---

# Security and RLS Review

-   RLS en todas las tablas expuestas.
-   Mínimo privilegio por rol y alcance.
-   React no es frontera de autorización; validar en DB/backend.
-   Nunca exponer service_role, certificados ARCA o claves privadas en
    frontend.
-   Revisar funciones SECURITY DEFINER, search_path y permisos EXECUTE.
-   Revisar políticas de Storage.
-   Probar lecturas/escrituras permitidas y denegadas para cada rol.
-   Verificar que usuarios no puedan elevar roles ni acceder a datos
    ajenos.
-   No registrar tokens, contraseñas ni claves fiscales.
-   Reportar hallazgos con severidad, evidencia, impacto y corrección.
    No afirmar que el sistema es seguro solo porque tiene login.
