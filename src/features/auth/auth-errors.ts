import { toAppError, type AppError } from '../../lib/errors'

interface AuthErrorLike {
  code?: unknown
  status?: unknown
  name?: unknown
}

/**
 * Errores de Supabase Auth en español. No revela si el email existe:
 * "credenciales inválidas" y "usuario inexistente" dan el mismo mensaje.
 */
export function toAuthError(error: unknown): AppError {
  const e = (typeof error === 'object' && error !== null ? error : {}) as AuthErrorLike
  const code = typeof e.code === 'string' ? e.code : ''

  switch (code) {
    case 'invalid_credentials':
    case 'user_not_found':
      return { kind: 'auth', code, message: 'Email o contraseña incorrectos.' }
    case 'email_not_confirmed':
      return { kind: 'auth', code, message: 'Tu usuario todavía no está habilitado. Pedile al encargado que lo active.' }
    case 'user_banned':
      return { kind: 'permission', code, message: 'Tu usuario está deshabilitado. Hablá con el encargado.' }
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return { kind: 'auth', code, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' }
  }

  if (e.status === 429) {
    return { kind: 'auth', code: 'RATE_LIMIT', message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' }
  }
  if (e.name === 'AuthApiError' && e.status === 400) {
    return { kind: 'auth', code: 'invalid_credentials', message: 'Email o contraseña incorrectos.' }
  }

  return toAppError(error)
}
