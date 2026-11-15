/**
 * Traduce errores de Supabase/PostgreSQL a mensajes en español para el usuario.
 * Los códigos de negocio están definidos en docs/DATA_CONTRACT.md §8.6.
 * Nunca se muestran al usuario mensajes crudos de la base.
 */

export type AppErrorKind =
  | 'network'
  | 'auth'
  | 'permission'
  | 'business'
  | 'constraint'
  /** La tabla o función todavía no existe en la base (el backend no la publicó). */
  | 'unavailable'
  | 'unknown'

export interface AppError {
  kind: AppErrorKind
  /** Código estable (de negocio, de PostgreSQL o interno). */
  code: string
  /** Mensaje listo para mostrar. */
  message: string
}

export const BUSINESS_ERROR_MESSAGES: Record<string, string> = {
  // Desde v0.3.1 también cubre a un usuario desactivado.
  NOT_AUTHORIZED: 'No tenés permiso para realizar esta operación o tu usuario está desactivado. Hablá con el encargado.',
  PRODUCT_NOT_FOUND: 'El producto no existe o no está disponible.',
  BATCH_NOT_FOUND: 'El lote no existe o no está disponible.',
  MOVEMENT_NOT_FOUND: 'El movimiento no existe o no está disponible.',
  PRODUCT_INACTIVE: 'El producto está inactivo: solo admite mermas, daños o devoluciones a proveedor.',
  INVALID_QUANTITY: 'La cantidad no es válida para la unidad de venta del producto.',
  INSUFFICIENT_STOCK:
    'No hay stock suficiente para esa operación. En las salidas no cuentan los lotes vencidos, salvo para mermas, daños o devoluciones a proveedor.',
  REASON_REQUIRED: 'Indicá el motivo del movimiento.',
  INVALID_MOVEMENT_TYPE: 'Ese tipo de movimiento no está permitido en esta operación.',
  ALREADY_REVERSED: 'Ese movimiento ya fue revertido.',
  IDEMPOTENCY_CONFLICT:
    'La operación ya se había enviado con otros datos. Recargá la pantalla y revisá el historial antes de repetirla.',
  BATCH_EXPIRED: 'El lote está vencido: solo admite mermas, daños o devoluciones a proveedor.',
  SKU_ALREADY_EXISTS: 'Ya existe un producto con ese SKU.',
  // Contrato v0.3.1 (§8.6): fecha del movimiento futura o con más de 7 días, o ingreso futuro.
  // Contrato v0.4.0 (§8.1): todo ingreso de stock lleva vencimiento.
  EXPIRY_REQUIRED: 'Indicá la fecha de vencimiento: todos los productos se controlan por vencimiento.',
  INVALID_DATE:
    'La fecha no es válida: no puede ser futura, y un movimiento se puede cargar con hasta 7 días de atraso.',
}

/** Mensajes por nombre de restricción única (contrato §5). */
export const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  products_sku_key: 'Ya existe un producto con ese SKU.',
  products_barcode_key: 'Ya existe un producto con ese código de barras.',
  products_legacy_code_key: 'Ya existe un producto con ese código anterior.',
  categories_name_key: 'Ya existe una categoría con ese nombre.',
  brands_name_key: 'Ya existe una marca con ese nombre.',
  suppliers_name_key: 'Ya existe un proveedor con ese nombre.',
  suppliers_tax_id_key: 'Ya existe un proveedor con ese CUIT.',
  expiry_alert_settings_category_key: 'Esa categoría ya tiene sus propios días de alerta. Editá la fila existente.',
}

const NETWORK_MESSAGE = 'No se pudo conectar con el servidor. Revisá la conexión a internet e intentá de nuevo.'
const UNKNOWN_MESSAGE = 'Ocurrió un error inesperado. Si se repite, avisá al administrador.'

interface ErrorLike {
  code?: unknown
  message?: unknown
  name?: unknown
  status?: unknown
}

export function toAppError(error: unknown): AppError {
  if (isNetworkError(error)) {
    return { kind: 'network', code: 'NETWORK', message: NETWORK_MESSAGE }
  }

  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message : ''

  // Errores de negocio lanzados por las RPC: ERRCODE P0001, MESSAGE = código.
  if (code === 'P0001') {
    const businessCode = message.trim()
    const text = BUSINESS_ERROR_MESSAGES[businessCode]
    return text
      ? { kind: businessCode === 'NOT_AUTHORIZED' ? 'permission' : 'business', code: businessCode, message: text }
      : { kind: 'unknown', code: 'P0001', message: UNKNOWN_MESSAGE }
  }

  switch (code) {
    case '23505': {
      const constraint = extractConstraintName(message)
      const text = (constraint && UNIQUE_CONSTRAINT_MESSAGES[constraint]) ?? 'Ya existe un registro con esos datos.'
      return { kind: 'constraint', code, message: text }
    }
    case '23514':
      return { kind: 'constraint', code, message: 'Algún dato no cumple las reglas permitidas. Revisá el formulario.' }
    case '23503':
      return {
        kind: 'constraint',
        code,
        message: 'El registro relacionado no existe o está en uso y no se puede modificar.',
      }
    case '23502':
      return { kind: 'constraint', code, message: 'Falta completar un dato obligatorio.' }
    case '42501':
      return { kind: 'permission', code, message: BUSINESS_ERROR_MESSAGES.NOT_AUTHORIZED ?? UNKNOWN_MESSAGE }
    case 'PGRST301':
    case 'PGRST302':
      return { kind: 'auth', code, message: 'Tu sesión expiró. Volvé a iniciar sesión.' }
    // Tabla/vista, función, relación o columna inexistente: el esquema del backend
    // todavía no tiene esa versión del contrato.
    case 'PGRST202':
    case 'PGRST205':
    case 'PGRST200':
    case '42P01':
    case '42883':
    case '42703':
      return {
        kind: 'unavailable',
        code,
        message: 'Esta función todavía no está disponible en el servidor. Avisá al responsable del sistema.',
      }
  }

  if (e.name === 'AuthApiError' || e.name === 'AuthSessionMissingError') {
    return { kind: 'auth', code: code || 'AUTH', message: 'No se pudo validar la sesión. Volvé a iniciar sesión.' }
  }

  return { kind: 'unknown', code: code || 'UNKNOWN', message: UNKNOWN_MESSAGE }
}

export function extractConstraintName(message: string): string | null {
  const match = /constraint "([^"]+)"/.exec(message)
  return match?.[1] ?? null
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return /fetch|network|load failed/i.test(error.message)
  }
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as ErrorLike
    if (name === 'AuthRetryableFetchError') return true
    if (typeof message === 'string' && /^(TypeError: )?(Failed to fetch|NetworkError|Load failed)/i.test(message)) {
      return true
    }
  }
  return false
}
