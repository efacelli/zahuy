import { describe, expect, it } from 'vitest'
import { EMPTY_SCAN, barcodeWarning, feedScan, hasValidCheckDigit, isBarcodeLike, type ScanBuffer } from './barcode'

/** Simula teclas con `gap` ms entre una y otra. */
function type(keys: string[], gap: number, start = 1000) {
  let buffer: ScanBuffer = EMPTY_SCAN
  let code: string | null = null
  keys.forEach((k, i) => {
    const r = feedScan(buffer, k, start + i * gap)
    buffer = r.buffer
    if (r.code) code = r.code
  })
  return code
}

describe('códigos de barras', () => {
  it('valida el dígito verificador GTIN', () => {
    expect(hasValidCheckDigit('7790001234567')).toBe(false)
    expect(hasValidCheckDigit('4006381333931')).toBe(true) // EAN-13
    expect(hasValidCheckDigit('96385074')).toBe(true) // EAN-8
    expect(hasValidCheckDigit('036000291452')).toBe(true) // UPC-A
    expect(hasValidCheckDigit('1234567890')).toBeNull() // 10 dígitos: código interno
  })

  it('avisa solo si el código parece mal leído', () => {
    expect(barcodeWarning('4006381333931')).toBeNull()
    expect(barcodeWarning('4006381333932')).toMatch(/dígito verificador/)
    expect(barcodeWarning('123')).toBeNull()
    expect(isBarcodeLike(' 4006381333931 ')).toBe(true)
  })

  it('detecta el lector: números muy seguidos y Enter', () => {
    expect(type([...'4006381333931', 'Enter'], 8)).toBe('4006381333931')
  })

  it('no confunde a una persona tipeando', () => {
    expect(type([...'4006381333931', 'Enter'], 150)).toBeNull()
  })

  it('ignora lecturas cortas o con letras', () => {
    expect(type([...'12345', 'Enter'], 8)).toBeNull()
    expect(type([...'40063A81333931', 'Enter'], 8)).toBeNull()
  })
})
