import { z } from 'zod'
import { isValidCuit, normalizeCuit } from '../../lib/cuit'

/** Catálogos de la Etapa 1 (contrato §5.2–5.4). */
export const CATALOG_KINDS = ['categories', 'brands', 'suppliers'] as const
export type CatalogKind = (typeof CATALOG_KINDS)[number]

export interface CatalogInfo {
  kind: CatalogKind
  /** Valor del parámetro `?tipo=` en la URL. */
  slug: string
  plural: string
  singular: string
  /** "la" / "el", para armar mensajes. */
  article: 'la' | 'el'
  nameMax: number
}

export const CATALOGS: Record<CatalogKind, CatalogInfo> = {
  categories: { kind: 'categories', slug: 'categorias', plural: 'Categorías', singular: 'categoría', article: 'la', nameMax: 80 },
  brands: { kind: 'brands', slug: 'marcas', plural: 'Marcas', singular: 'marca', article: 'la', nameMax: 80 },
  suppliers: { kind: 'suppliers', slug: 'proveedores', plural: 'Proveedores', singular: 'proveedor', article: 'el', nameMax: 120 },
}

export function catalogFromSlug(slug: string | null): CatalogInfo {
  return Object.values(CATALOGS).find((c) => c.slug === slug) ?? CATALOGS.categories
}

/** Fila tal como la devuelve la base. */
export interface CatalogRow {
  id: string
  name: string
  is_active: boolean
  tax_id?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
}

export interface CatalogFormValues {
  name: string
  tax_id: string
  phone: string
  email: string
  notes: string
}

export function emptyCatalogForm(row?: CatalogRow | null): CatalogFormValues {
  return {
    name: row?.name ?? '',
    tax_id: row?.tax_id ?? '',
    phone: row?.phone ?? '',
    email: row?.email ?? '',
    notes: row?.notes ?? '',
  }
}

const nullable = (v: string) => (v.trim() === '' ? null : v.trim())

/**
 * Validación y armado del payload. Para categorías y marcas solo se envía `name`;
 * para proveedores, también los datos de contacto (contrato §5.4).
 */
export function catalogFormSchema(info: CatalogInfo) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Ingresá el nombre.')
        .max(info.nameMax, `El nombre admite hasta ${info.nameMax} caracteres.`),
      tax_id: z
        .string()
        .refine((v) => v.trim() === '' || isValidCuit(v), 'El CUIT no es válido (revisá los 11 números).'),
      phone: z.string().trim().max(40, 'El teléfono es demasiado largo.'),
      email: z.string().trim().refine((v) => v === '' || z.email().safeParse(v).success, 'El email no es válido.'),
      notes: z.string().max(1000, 'Las notas admiten hasta 1000 caracteres.'),
    })
    .transform((v): Record<string, string | null> =>
      info.kind === 'suppliers'
        ? {
            name: v.name,
            tax_id: v.tax_id.trim() === '' ? null : normalizeCuit(v.tax_id),
            phone: nullable(v.phone),
            email: nullable(v.email)?.toLowerCase() ?? null,
            notes: nullable(v.notes),
          }
        : { name: v.name },
    )
}
