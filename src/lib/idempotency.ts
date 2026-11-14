/**
 * Clave de idempotencia para operaciones de stock (contrato §8.5).
 * Se genera UNA vez al abrir el formulario y se reutiliza en los reintentos
 * hasta recibir una respuesta definitiva; así un reintento no duplica el movimiento.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
