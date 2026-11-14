import { describe, expect, it } from 'vitest'
import { BUSINESS_ERROR_MESSAGES, extractConstraintName, toAppError } from './errors'

describe('toAppError', () => {
  it('traduce los errores de negocio de las RPC (P0001)', () => {
    const error = toAppError({ code: 'P0001', message: 'INSUFFICIENT_STOCK' })
    expect(error).toEqual({
      kind: 'business',
      code: 'INSUFFICIENT_STOCK',
      message: BUSINESS_ERROR_MESSAGES.INSUFFICIENT_STOCK,
    })
  })

  it('traduce INVALID_DATE (contrato v0.3.1)', () => {
    const error = toAppError({ code: 'P0001', message: 'INVALID_DATE' })
    expect(error.kind).toBe('business')
    expect(error.code).toBe('INVALID_DATE')
    expect(error.message).toMatch(/no puede ser futura/)
  })

  it('traduce todos los códigos de negocio del contrato §8.6', () => {
    const codes = [
      'NOT_AUTHORIZED', 'PRODUCT_NOT_FOUND', 'BATCH_NOT_FOUND', 'MOVEMENT_NOT_FOUND', 'PRODUCT_INACTIVE',
      'INVALID_QUANTITY', 'SKU_ALREADY_EXISTS', 'INSUFFICIENT_STOCK', 'REASON_REQUIRED', 'INVALID_MOVEMENT_TYPE',
      'ALREADY_REVERSED', 'BATCH_EXPIRED', 'IDEMPOTENCY_CONFLICT', 'INVALID_DATE',
    ]
    for (const code of codes) {
      expect(toAppError({ code: 'P0001', message: code }).code).toBe(code)
    }
  })

  it('trata NOT_AUTHORIZED como error de permisos', () => {
    expect(toAppError({ code: 'P0001', message: 'NOT_AUTHORIZED' }).kind).toBe('permission')
  })

  it('no muestra mensajes crudos ante un P0001 desconocido', () => {
    const error = toAppError({ code: 'P0001', message: 'relation "x" does not exist' })
    expect(error.kind).toBe('unknown')
    expect(error.message).not.toContain('relation')
  })

  it('identifica el SKU duplicado por el nombre de la restricción', () => {
    const error = toAppError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "products_sku_key"',
    })
    expect(error.kind).toBe('constraint')
    expect(error.message).toBe('Ya existe un producto con ese SKU.')
  })

  it('da un mensaje genérico para otras restricciones únicas', () => {
    const error = toAppError({ code: '23505', message: 'duplicate key value violates unique constraint "otra"' })
    expect(error.message).toBe('Ya existe un registro con esos datos.')
  })

  it('mapea CHECK, FK y RLS', () => {
    expect(toAppError({ code: '23514', message: '' }).kind).toBe('constraint')
    expect(toAppError({ code: '23503', message: '' }).kind).toBe('constraint')
    expect(toAppError({ code: '42501', message: 'new row violates row-level security policy' }).kind).toBe(
      'permission',
    )
  })

  it('detecta errores de red', () => {
    expect(toAppError(new TypeError('Failed to fetch')).kind).toBe('network')
    expect(toAppError({ message: 'TypeError: Failed to fetch', code: '' }).kind).toBe('network')
    expect(toAppError({ name: 'AuthRetryableFetchError', message: 'x' }).kind).toBe('network')
  })

  it('avisa cuando una tabla o función todavía no existe en el servidor', () => {
    for (const code of ['PGRST202', 'PGRST205', '42P01', '42883']) {
      expect(toAppError({ code, message: 'Could not find the function' }).kind).toBe('unavailable')
    }
  })

  it('detecta sesión expirada', () => {
    expect(toAppError({ code: 'PGRST301', message: 'JWT expired' }).kind).toBe('auth')
  })

  it('maneja valores que no son objetos', () => {
    expect(toAppError('algo').kind).toBe('unknown')
    expect(toAppError(null).kind).toBe('unknown')
  })
})

describe('extractConstraintName', () => {
  it('extrae el nombre entre comillas', () => {
    expect(extractConstraintName('violates unique constraint "brands_name_key"')).toBe('brands_name_key')
    expect(extractConstraintName('sin restricción')).toBeNull()
  })
})
