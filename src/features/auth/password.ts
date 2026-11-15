/**
 * Reglas de contraseña de producción (docs/DEPLOY.md §3): 10 caracteres o más,
 * con letras y números. Supabase Auth vuelve a validarlas.
 */
export const MIN_PASSWORD_LENGTH = 10

export interface ChangePasswordValues {
  current: string
  next: string
  repeat: string
}

export type ChangePasswordErrors = Partial<Record<keyof ChangePasswordValues, string>>

export function validateChangePassword(v: ChangePasswordValues): ChangePasswordErrors {
  const errors: ChangePasswordErrors = {}
  if (v.current === '') errors.current = 'Ingresá tu contraseña actual.'
  if (v.next.length < MIN_PASSWORD_LENGTH) errors.next = `Tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  else if (!/[A-Za-z]/.test(v.next) || !/[0-9]/.test(v.next)) errors.next = 'Tiene que tener letras y números.'
  else if (v.next === v.current) errors.next = 'Tiene que ser distinta de la actual.'
  if (v.repeat !== v.next) errors.repeat = 'No coincide con la nueva contraseña.'
  return errors
}

/** Mensaje en castellano para los errores de Supabase Auth al cambiar la contraseña. */
export function passwordErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 'invalid_credentials':
      return 'La contraseña actual no es correcta.'
    case 'weak_password':
      return `La contraseña nueva es débil: al menos ${MIN_PASSWORD_LENGTH} caracteres, con letras y números.`
    case 'same_password':
      return 'La contraseña nueva tiene que ser distinta de la actual.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.'
    default:
      return 'No se pudo cambiar la contraseña. Probá de nuevo; si se repite, avisá al dueño.'
  }
}
