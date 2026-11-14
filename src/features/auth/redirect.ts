/**
 * Ruta a la que volver después de ingresar. Solo se aceptan rutas internas
 * para evitar redirecciones abiertas (p. ej. `?volver=https://otro-sitio`).
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (value.startsWith('/login')) return '/'
  return value
}

export function loginPath(from: string): string {
  return from && from !== '/' ? `/login?volver=${encodeURIComponent(from)}` : '/login'
}
