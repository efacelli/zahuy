import { describe, expect, it } from 'vitest'
import { pageCount, pageRange } from './pagination'

describe('pagination', () => {
  it('calcula la cantidad de páginas (mínimo 1)', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
  })

  it('calcula el rango inclusivo para Supabase', () => {
    expect(pageRange(1, 25)).toEqual([0, 24])
    expect(pageRange(3, 25)).toEqual([50, 74])
    expect(pageRange(0, 25)).toEqual([0, 24])
  })
})
