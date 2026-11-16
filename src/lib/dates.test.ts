import { describe, expect, it } from 'vitest'
import { daysUntil, formatDate, formatDateTime, isIsoDate, parseTypedDate, todayInAppTimeZone } from './dates'

describe('todayInAppTimeZone', () => {
  it('usa la hora argentina, no UTC (contrato §2.4)', () => {
    // 01:30 UTC del 14/11 = 22:30 del 13/11 en Buenos Aires.
    expect(todayInAppTimeZone(new Date('2026-11-14T01:30:00Z'))).toBe('2026-11-13')
    // 03:00 UTC = medianoche en Buenos Aires.
    expect(todayInAppTimeZone(new Date('2026-11-14T03:00:00Z'))).toBe('2026-11-14')
  })
})

describe('isIsoDate', () => {
  it('valida fechas reales', () => {
    expect(isIsoDate('2026-12-15')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('15/12/2026')).toBe(false)
  })
})

describe('formatDate', () => {
  it('formatea sin corrimiento de zona horaria', () => {
    expect(formatDate('2026-12-15')).toBe('15/12/2026')
  })

  it('muestra guion si no hay fecha (producto sin vencimiento)', () => {
    expect(formatDate(null)).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('muestra el instante en hora argentina', () => {
    expect(formatDateTime('2026-11-14T13:05:00Z')).toBe('14/11/2026 10:05')
  })
})

describe('daysUntil', () => {
  it('cuenta días respecto de hoy', () => {
    expect(daysUntil('2026-12-15', '2026-11-15')).toBe(30)
    expect(daysUntil('2026-11-15', '2026-11-15')).toBe(0)
    expect(daysUntil('2026-11-10', '2026-11-15')).toBe(-5)
  })

  it('cruza el cambio de año', () => {
    expect(daysUntil('2027-01-02', '2026-12-28')).toBe(5)
  })

  it('rechaza fechas inválidas', () => {
    expect(() => daysUntil('mal', '2026-11-15')).toThrow(RangeError)
  })
})

describe('parseTypedDate (carga rápida con teclado)', () => {
  it('acepta con y sin barras, año de 2 o 4 cifras', () => {
    expect(parseTypedDate('10/03/2027')).toBe('2027-03-10')
    expect(parseTypedDate('1/3/27')).toBe('2027-03-01')
    expect(parseTypedDate('10-03-27')).toBe('2027-03-10')
    expect(parseTypedDate('100327')).toBe('2027-03-10')
    expect(parseTypedDate('10032027')).toBe('2027-03-10')
  })

  it('rechaza fechas que no existen o texto incompleto', () => {
    expect(parseTypedDate('31/02/2027')).toBeNull()
    expect(parseTypedDate('1003')).toBeNull()
    expect(parseTypedDate('')).toBeNull()
    expect(parseTypedDate('mañana')).toBeNull()
  })
})
