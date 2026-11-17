import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * Imagen opcional del producto (contrato §5.5 y §9). El archivo va al bucket
 * privado `product-images` y `products.image_path` guarda su ruta, nunca una URL.
 * Para mostrarla se pide una URL firmada que vence.
 *
 * Convención de ruta: `<product_id>/<uuid>.<ext>`. Cada carga usa un nombre
 * nuevo (sin problemas de caché) y la anterior se borra después de guardar.
 * Suben y quitan imágenes el encargado y el dueño; la base lo vuelve a validar.
 */

export const PRODUCT_IMAGES_BUCKET = 'product-images'
/** Límites del bucket (migración 20261116230000). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** Lado mayor después de achicar: alcanza para la ficha y pesa poco. */
const MAX_SIDE = 1000
const SIGNED_URL_SECONDS = 60 * 60

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export function productImageKey(path: string | null) {
  return ['product-image', path] as const
}

export function validateImageFile(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Elegí una foto JPG, PNG o WebP.'
  }
  return null
}

/**
 * Achica la foto (las del celular pesan varios MB) y la pasa a WebP o JPEG.
 * Si el navegador no puede procesarla, usa el archivo original.
 */
export async function prepareImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin canvas')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    // Safari viejo no genera WebP y devuelve PNG: en ese caso, JPEG.
    if (blob && blob.type === 'image/webp') return blob
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (jpeg) return jpeg
    throw new Error('sin blob')
  } catch {
    return file
  }
}

export function imagePathFor(productId: string, type: string): string {
  return `${productId}/${crypto.randomUUID()}.${EXTENSION[type] ?? 'jpg'}`
}

/** 0 filas en un UPDATE con RLS no es error: se informa como falta de permiso. */
async function setImagePath(client: SupabaseClient, productId: string, path: string | null): Promise<void> {
  const { error } = await client.from('products').update({ image_path: path }).eq('id', productId).select('id').single()
  if (error) {
    const code = (error as { code?: unknown }).code
    throw code === 'PGRST116' ? { code: '42501', message: 'UPDATE_NO_ROWS' } : error
  }
}

async function removeFile(client: SupabaseClient, path: string | null) {
  if (!path) return
  // Si falla, queda un archivo huérfano en el bucket; no afecta al producto.
  await client.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
}

/** Sube la imagen, la asigna al producto y recién después borra la anterior. */
export async function uploadProductImage(
  client: SupabaseClient,
  productId: string,
  image: Blob,
  previousPath: string | null,
): Promise<string> {
  if (image.size > MAX_IMAGE_BYTES) throw { code: 'IMAGE_TOO_LARGE', message: 'IMAGE_TOO_LARGE' }
  const type = (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(image.type) ? image.type : 'image/jpeg'
  const path = imagePathFor(productId, type)
  const { error } = await client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, image, { contentType: type, upsert: false, cacheControl: '3600' })
  if (error) throw error
  try {
    await setImagePath(client, productId, path)
  } catch (e) {
    await removeFile(client, path)
    throw e
  }
  await removeFile(client, previousPath)
  return path
}

/** Quita la imagen del producto y borra el archivo. */
export async function removeProductImage(client: SupabaseClient, productId: string, path: string): Promise<void> {
  await setImagePath(client, productId, null)
  await removeFile(client, path)
}

export async function signedImageUrl(client: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await client.storage.from(PRODUCT_IMAGES_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

/** Mensaje para el usuario; los errores de Storage no siguen el formato de PostgREST. */
export function imageErrorMessage(error: unknown, fallback: (e: unknown) => string): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; statusCode?: unknown }
  if (e.code === 'IMAGE_TOO_LARGE' || e.statusCode === '413' || /exceeded the maximum/i.test(String(e.message))) {
    return 'La foto pesa más de 5 MB. Probá con otra o sacala con menos resolución.'
  }
  if (/mime type/i.test(String(e.message))) return 'Elegí una foto JPG, PNG o WebP.'
  if (e.statusCode === '403' || /row-level security|unauthorized/i.test(String(e.message))) {
    return 'No tenés permiso para cambiar la imagen. Hablá con el encargado.'
  }
  return fallback(error)
}
