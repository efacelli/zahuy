import { lazy, type ComponentType } from 'react'

const RELOAD_FLAG = 'zahuy.chunk-reload'

/**
 * Carga una pantalla recién cuando se abre (divide el bundle por rutas).
 * Si el archivo ya no existe porque se publicó una versión nueva mientras la
 * pestaña estaba abierta, recarga la página una sola vez para traer la nueva.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(async () => {
    try {
      const module = await load()
      safeSession(() => sessionStorage.removeItem(RELOAD_FLAG))
      return { default: module[name] as ComponentType }
    } catch (error) {
      const alreadyReloaded = safeSession(() => sessionStorage.getItem(RELOAD_FLAG)) === '1'
      if (!alreadyReloaded) {
        safeSession(() => sessionStorage.setItem(RELOAD_FLAG, '1'))
        window.location.reload()
        // Mientras recarga, no se muestra el error.
        return new Promise<never>(() => {})
      }
      throw error
    }
  })
}

function safeSession<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}
