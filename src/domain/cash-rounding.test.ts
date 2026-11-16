import { describe, expect, it } from 'vitest'
import { cashRoundingDelta, roundCash } from './cash-rounding'

describe('redondeo del efectivo (P-30)', () => {
  it('a la centena más cercana; 50 o más sube', () => {
    expect(roundCash(1237)).toBe(1200)
    expect(roundCash(1249)).toBe(1200)
    expect(roundCash(1249.99)).toBe(1200)
    expect(roundCash(1250)).toBe(1300)
    expect(roundCash(1280)).toBe(1300)
    expect(roundCash(1200)).toBe(1200)
    expect(roundCash(30)).toBe(30)
    expect(roundCash(49.99)).toBe(49.99)
    expect(roundCash(50)).toBe(100)
  })

  it('el múltiplo es configurable', () => {
    expect(roundCash(1237, 50)).toBe(1250)
    expect(roundCash(1224.99, 50)).toBe(1200)
  })

  it('la diferencia queda con signo', () => {
    expect(cashRoundingDelta(1237)).toBe(-37)
    expect(cashRoundingDelta(1250)).toBe(50)
    expect(cashRoundingDelta(1199.5)).toBe(0.5)
  })
})
