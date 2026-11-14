import { z } from 'zod'
import { SALE_UNIT_LABEL, SALE_UNITS, isIntegerUnit, type SaleUnit } from '../../domain/units'
import { VAT_RATES } from '../../domain/vat'
import { isIsoDate, todayInAppTimeZone } from '../../lib/dates'
import { decimalsInInput, parseDecimalInput } from '../../lib/numbers'

/**
 * Validaciones del alta de producto. Repiten las restricciones de la base
 * (contrato §5.5, §5.6 y §8.4) para avisar antes de enviar; la base vuelve a validar.
 */

const MAX_MONEY = 9_999_999_999.99
const MAX_QUANTITY = 999_999_999.999

/** Valores tal como están en el formulario (todo texto, como lo escribe el usuario). */
export interface ProductFormValues {
  barcode: string
  name: string
  description: string
  category_id: string
  brand_id: string
  supplier_id: string
  sale_unit: SaleUnit
  cost_price: string
  sale_price: string
  vat_rate: string
  boxes_quantity: string
  units_per_box: string
  min_stock: string
  is_active: boolean
  initial_quantity: string
  received_on: string
  expires_on: string
  batch_number: string
}

export function emptyProductForm(today = todayInAppTimeZone()): ProductFormValues {
  return {
    barcode: '',
    name: '',
    description: '',
    category_id: '',
    brand_id: '',
    supplier_id: '',
    sale_unit: 'unit',
    cost_price: '',
    sale_price: '',
    vat_rate: '21',
    boxes_quantity: '0',
    units_per_box: '12',
    min_stock: '0',
    is_active: true,
    initial_quantity: '',
    received_on: today,
    expires_on: '',
    batch_number: '',
  }
}

/** Datos validados y normalizados, listos para `create_product`. */
export interface ProductFormOutput {
  barcode: string | null
  name: string
  description: string | null
  category_id: string
  brand_id: string
  supplier_id: string | null
  sale_unit: SaleUnit
  cost_price: number
  sale_price: number
  vat_rate: number
  boxes_quantity: number
  units_per_box: number
  min_stock: number
  is_active: boolean
  initial_stock: {
    quantity: number
    received_on: string
    expires_on: string
    batch_number: string | null
  } | null
}

const optionalText = (value: string): string | null => {
  const t = value.trim()
  return t === '' ? null : t
}

const uuidField = (message: string) => z.string().trim().min(1, message).pipe(z.uuid(message))

export function productFormSchema(today = todayInAppTimeZone()) {
  return z
    .object({
      barcode: z
        .string()
        .trim()
        .refine((v) => v === '' || /^[0-9]{8,14}$/.test(v), 'El código de barras debe tener entre 8 y 14 números.'),
      name: z.string().trim().min(1, 'Ingresá el nombre.').max(150, 'El nombre admite hasta 150 caracteres.'),
      description: z.string(),
      category_id: uuidField('Elegí una categoría.'),
      brand_id: uuidField('Elegí una marca.'),
      supplier_id: z.string().trim().refine((v) => v === '' || z.uuid().safeParse(v).success, 'Proveedor inválido.'),
      sale_unit: z.enum(SALE_UNITS, 'Elegí la unidad de venta.'),
      cost_price: z.string(),
      sale_price: z.string(),
      vat_rate: z.string().refine((v) => VAT_RATES.includes(Number(v) as never), 'Elegí 21% o 10,5%.'),
      boxes_quantity: z.string(),
      units_per_box: z.string(),
      min_stock: z.string(),
      is_active: z.boolean(),
      initial_quantity: z.string(),
      received_on: z.string(),
      expires_on: z.string(),
      batch_number: z.string(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof ProductFormValues, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

      for (const [field, label] of [
        ['cost_price', 'el costo'],
        ['sale_price', 'el precio de venta'],
      ] as const) {
        const raw = v[field]
        const n = parseDecimalInput(raw)
        if (raw.trim() === '') issue(field, `Ingresá ${label}.`)
        else if (n === null) issue(field, 'Ingresá un número (por ejemplo 1250,50).')
        else if (decimalsInInput(raw) > 2) issue(field, 'Se admiten hasta 2 decimales.')
        else if (n > MAX_MONEY) issue(field, 'El importe es demasiado grande.')
      }

      const boxes = v.boxes_quantity.trim()
      if (boxes !== '' && !/^\d+$/.test(boxes)) issue('boxes_quantity', 'Ingresá un número entero de cajas (0 o más).')

      // Contrato v0.4.0 §5.5: unidades por caja, entero mayor que cero (12 por defecto).
      const perBox = v.units_per_box.trim()
      if (!/^\d+$/.test(perBox) || Number(perBox) <= 0) issue('units_per_box', 'Ingresá cuántas unidades trae cada caja (1 o más).')
      else if (Number(perBox) > 100_000) issue('units_per_box', 'El número es demasiado grande.')

      const integer = isIntegerUnit(v.sale_unit)
      const unitLabel = SALE_UNIT_LABEL[v.sale_unit]

      const minRaw = v.min_stock.trim()
      if (minRaw !== '') {
        const n = parseDecimalInput(minRaw)
        if (n === null) issue('min_stock', 'Ingresá un número (0 o más).')
        else if (integer && !Number.isInteger(n)) issue('min_stock', `Para "${unitLabel}" el stock mínimo debe ser entero.`)
        else if (decimalsInInput(minRaw) > 3) issue('min_stock', 'Se admiten hasta 3 decimales.')
        else if (n > MAX_QUANTITY) issue('min_stock', 'El número es demasiado grande.')
      }

      // Stock inicial: opcional. Si no hay cantidad, los datos del lote se ignoran.
      const qtyRaw = v.initial_quantity.trim()
      if (qtyRaw === '') return
      const qty = parseDecimalInput(qtyRaw)
      if (qty === null) issue('initial_quantity', 'Ingresá un número.')
      else if (qty <= 0) issue('initial_quantity', 'La cantidad debe ser mayor que cero, o dejala vacía.')
      else if (integer && !Number.isInteger(qty)) issue('initial_quantity', `Para "${unitLabel}" la cantidad debe ser entera.`)
      else if (decimalsInInput(qtyRaw) > 3) issue('initial_quantity', 'Se admiten hasta 3 decimales.')
      else if (qty > MAX_QUANTITY) issue('initial_quantity', 'La cantidad es demasiado grande.')

      if (!isIsoDate(v.received_on)) issue('received_on', 'Ingresá la fecha de ingreso.')
      else if (v.received_on > today) issue('received_on', 'La fecha de ingreso no puede ser futura.')

      // Contrato v0.4.0 §8.1: todo ingreso lleva vencimiento (también limpieza y bazar).
      if (v.expires_on === '') issue('expires_on', 'Indicá la fecha de vencimiento.')
      else if (!isIsoDate(v.expires_on)) issue('expires_on', 'La fecha de vencimiento no es válida.')
    })
    .transform(
      (v): ProductFormOutput => ({
        barcode: optionalText(v.barcode),
        name: v.name,
        description: optionalText(v.description),
        category_id: v.category_id,
        brand_id: v.brand_id,
        supplier_id: optionalText(v.supplier_id),
        sale_unit: v.sale_unit,
        cost_price: parseDecimalInput(v.cost_price) ?? 0,
        sale_price: parseDecimalInput(v.sale_price) ?? 0,
        vat_rate: Number(v.vat_rate),
        boxes_quantity: Number(v.boxes_quantity.trim() || '0'),
        units_per_box: Number(v.units_per_box.trim()),
        min_stock: parseDecimalInput(v.min_stock.trim() || '0') ?? 0,
        is_active: v.is_active,
        initial_stock:
          v.initial_quantity.trim() === ''
            ? null
            : {
                quantity: parseDecimalInput(v.initial_quantity) ?? 0,
                received_on: v.received_on,
                expires_on: v.expires_on,
                batch_number: optionalText(v.batch_number),
              },
      }),
    )
}

/** Avisos que no bloquean el guardado (contrato P-09). */
export function productFormWarnings(values: ProductFormValues, today = todayInAppTimeZone()): string[] {
  const warnings: string[] = []
  const cost = parseDecimalInput(values.cost_price)
  const price = parseDecimalInput(values.sale_price)
  if (cost !== null && price !== null && price < cost) {
    warnings.push('El precio de venta es menor que el costo.')
  }
  if (values.initial_quantity.trim() !== '' && isIsoDate(values.expires_on)) {
    if (isIsoDate(values.received_on) && values.expires_on < values.received_on) {
      warnings.push('La fecha de vencimiento es anterior a la de ingreso.')
    }
    if (values.expires_on < today) warnings.push('El lote ya está vencido.')
  }
  return warnings
}
