import { describe, expect, it } from 'vitest'
import { alertLevelFor, EXPIRY_STATUSES } from './expiry'
import { MOVEMENT_TYPE_INFO, MOVEMENT_TYPES, movementTypesFor, movementTypesForProduct, signedQuantity } from './movements'
import { formatQuantity, SALE_UNITS, validateQuantity } from './units'
import { formatVatRate } from './vat'

describe('alertLevelFor (contrato §4.4)', () => {
  it('agrupa 30 y 15 días como próximo a vencer', () => {
    expect(alertLevelFor('expires_upcoming')).toBe('warning')
    expect(alertLevelFor('expires_soon')).toBe('warning')
  })

  it('marca 7 días como urgente y vencido como vencido', () => {
    expect(alertLevelFor('expires_urgent')).toBe('urgent')
    expect(alertLevelFor('expired')).toBe('expired')
  })

  it('no alerta lotes agotados, sin vencimiento ni vigentes', () => {
    expect(alertLevelFor('depleted')).toBeNull()
    expect(alertLevelFor('no_expiry')).toBeNull()
    expect(alertLevelFor('ok')).toBeNull()
  })

  it('cubre todos los estados', () => {
    for (const status of EXPIRY_STATUSES) expect(() => alertLevelFor(status)).not.toThrow()
  })
})

describe('validateQuantity', () => {
  it('rechaza cero y negativos', () => {
    expect(validateQuantity('unit', 0)).not.toBeNull()
    expect(validateQuantity('kg', -1)).not.toBeNull()
  })

  it('exige enteros en unidad, pack, caja y otra', () => {
    for (const unit of ['unit', 'pack', 'box', 'other'] as const) {
      expect(validateQuantity(unit, 1.5)).not.toBeNull()
      expect(validateQuantity(unit, 2)).toBeNull()
    }
  })

  it('admite hasta 3 decimales en kilo y litro', () => {
    expect(validateQuantity('kg', 1.255)).toBeNull()
    expect(validateQuantity('l', 0.5)).toBeNull()
    expect(validateQuantity('kg', 1.2555)).not.toBeNull()
  })

  it('rechaza valores no numéricos', () => {
    expect(validateQuantity('unit', Number.NaN)).not.toBeNull()
  })
})

describe('formatQuantity', () => {
  it('formatea con sufijo de unidad', () => {
    expect(formatQuantity(120, 'unit')).toBe('120 u.')
    expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg')
  })

  it('tiene etiqueta para cada unidad', () => {
    for (const unit of SALE_UNITS) expect(formatQuantity(1, unit)).toMatch(/^1/)
  })
})

describe('movimientos (contrato §4.3)', () => {
  it('suman: ingreso, ajuste positivo, devolución de cliente', () => {
    const ins = MOVEMENT_TYPES.filter((t) => MOVEMENT_TYPE_INFO[t].direction === 'in')
    expect(ins).toEqual(['entry', 'adjustment_in', 'customer_return'])
  })

  it('el signo sale del tipo, la cantidad siempre es positiva', () => {
    expect(signedQuantity('entry', 5)).toBe(5)
    expect(signedQuantity('shrinkage', 5)).toBe(-5)
  })

  it('exigen motivo todos salvo ingreso y salida', () => {
    const withoutReason = MOVEMENT_TYPES.filter((t) => !MOVEMENT_TYPE_INFO[t].reasonRequired)
    expect(withoutReason).toEqual(['entry', 'exit', 'sale'])
  })

  it('consumo interno es una salida con motivo (v0.4.0)', () => {
    expect(MOVEMENT_TYPE_INFO.internal_use).toMatchObject({ direction: 'out', reasonRequired: true })
    expect(signedQuantity('internal_use', 3)).toBe(-3)
  })

  it('el empleado solo registra consumo interno; el encargado, todo salvo ingresos', () => {
    expect(movementTypesFor(false)).toEqual(['internal_use'])
    expect(movementTypesFor(true)).not.toContain('entry')
    expect(movementTypesFor(true)).toHaveLength(8)
  })

  it('un producto inactivo solo admite merma, daño y devolución a proveedor (P-13)', () => {
    expect(movementTypesForProduct(movementTypesFor(true), false)).toEqual(['shrinkage', 'damage', 'supplier_return'])
    expect(movementTypesForProduct(movementTypesFor(true), true)).toHaveLength(8)
    expect(movementTypesForProduct(movementTypesFor(false), false)).toEqual([])
  })
})

describe('formatVatRate', () => {
  it('usa coma decimal', () => {
    expect(formatVatRate(10.5)).toBe('10,5%')
    expect(formatVatRate(21)).toBe('21%')
  })
})
