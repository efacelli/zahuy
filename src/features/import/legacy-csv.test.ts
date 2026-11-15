import { describe, expect, it } from 'vitest'
import {
  decodeText,
  filterSince,
  finalPriceFromSale,
  idempotencyKeyFor,
  parseDate,
  parseLegacyFile,
  parseNumber,
  salePriceFromFinal,
} from './legacy-csv'

/** Como lo guarda Excel en castellano: `;`, coma decimal y dos filas antes de los títulos. */
const EXCEL_AR = [
  'Listado de precios;;;;;;;;;;',
  ';;;;;;;;;;',
  'Codigo Propio;Descripcion;Lista      ;Costo      ;Costo Total      ;Iva      ;Costo Con Iva      ;Publico      ;Categoria;Marca;Fecha Actualizacion      ',
  '31884325;Protectores FICTICIOS x 20 u;712;712;712;21;861,52;1200;;;23/07/2026',
  '001;HARINA DEMO 0000 X 25 KG;337;337;337;21;407,77;550;;;26/02/2019',
  '1002;Leche demo 1 L;400;400;400;10,5;442;"1.234,50";;;01/03/2025',
  '1003;"Galletitas ""rellenas"" demo";100;100;100;27;127;150;;;01/03/2025',
  '001;Repetido demo;1;1;1;21;1,21;2;;;01/03/2025',
  ';Sin código demo;1;1;1;21;1,21;2;;;01/03/2025',
  '1004;Sin precio demo;1;1;1;21;1,21;0;;;01/03/2025',
  '',
].join('\r\n')

describe('lectura de la exportación del sistema anterior', () => {
  it('reconoce títulos, separador, coma decimal, miles y comillas', () => {
    const r = parseLegacyFile(EXCEL_AR)
    expect(r.totalRows).toBe(7)
    expect(r.items.map((i) => i.legacyCode)).toEqual(['31884325', '001', '1002'])
    expect(r.items[0]).toMatchObject({
      line: 4,
      name: 'Protectores FICTICIOS x 20 u',
      costPrice: 712,
      finalPrice: 1200,
      vatRate: 21,
      salePrice: 991.7355,
      updatedOn: '2026-07-23',
    })
    expect(r.items[2]).toMatchObject({ vatRate: 10.5, finalPrice: 1234.5 })
  })

  it('informa cada fila con problema, con su número', () => {
    const r = parseLegacyFile(EXCEL_AR)
    expect(r.problems).toEqual([
      { line: 7, legacyCode: '1003', message: 'IVA no admitido (27); solo 21 o 10,5.' },
      { line: 8, legacyCode: '001', message: 'Código propio repetido en el archivo (también en la fila 5).' },
      { line: 9, legacyCode: null, message: 'Falta el código propio.' },
      { line: 10, legacyCode: '1004', message: 'El precio al público falta o es cero.' },
    ])
  })

  it('sin la columna Descripcion lo dice', () => {
    expect(parseLegacyFile('a;b;c\n1;2;3').problems[0]?.message).toMatch(/fila de títulos/)
  })

  it('acepta CSV con coma como separador y punto decimal', () => {
    const r = parseLegacyFile('Codigo Propio,Descripcion,Costo,Iva,Publico\n10,Demo,"1,234.50",21,861.52')
    expect(r.items[0]).toMatchObject({ costPrice: 1234.5, finalPrice: 861.52 })
  })

  it('filtra por fecha de actualización (P-26)', () => {
    const items = parseLegacyFile(EXCEL_AR).items
    expect(filterSince(items, '2025-01-01').map((i) => i.legacyCode)).toEqual(['31884325', '1002'])
    expect(filterSince(items, null)).toHaveLength(3)
  })
})

describe('precio final exacto (P-24)', () => {
  it('con 4 decimales el precio final se reproduce exacto', () => {
    for (const final of [1200, 550, 861.52, 0.01, 99999.99, 1234.5, 7.99]) {
      for (const vat of [21, 10.5]) {
        expect(finalPriceFromSale(salePriceFromFinal(final, vat), vat)).toBe(final)
      }
    }
  })
})

describe('auxiliares', () => {
  it('números y fechas', () => {
    expect(parseNumber('1.234,50', true)).toBe(1234.5)
    expect(parseNumber('$ 1200', true)).toBe(1200)
    expect(parseNumber('abc', true)).toBeNull()
    expect(parseDate('5/3/2025')).toBe('2025-03-05')
    expect(parseDate('2026-07-23 00:00:00')).toBe('2026-07-23')
    expect(parseDate('')).toBeNull()
  })

  it('decodifica UTF-8 y, si no es válido, Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('﻿Descripción').buffer as ArrayBuffer)).toBe('Descripción')
    expect(decodeText(new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0x70, 0x63, 0x69, 0xf3, 0x6e]).buffer)).toBe(
      'Descripción',
    )
  })

  it('la clave de idempotencia es estable y con formato UUID', async () => {
    const a = await idempotencyKeyFor('001')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await idempotencyKeyFor('001')).toBe(a)
    expect(await idempotencyKeyFor('002')).not.toBe(a)
  })
})
