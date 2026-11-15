import { useEffect, useRef } from 'react'
import { EMPTY_SCAN, feedScan, type ScanBuffer } from '../../domain/barcode'

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Escucha el lector USB cuando el foco NO está en un campo (si está en un campo,
 * el lector escribe ahí como un teclado y lo maneja ese campo). Tampoco actúa con
 * un diálogo abierto, para no sacar a nadie de una carga a medias.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef<ScanBuffer>(EMPTY_SCAN)
  const handler = useRef(onScan)
  useEffect(() => {
    handler.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (isEditable(event.target) || document.querySelector('[role="dialog"]')) {
        buffer.current = EMPTY_SCAN
        return
      }
      const { buffer: next, code } = feedScan(buffer.current, event.key, event.timeStamp || performance.now())
      buffer.current = next
      if (code) {
        // Que el Enter del lector no active el botón que tenga el foco.
        event.preventDefault()
        event.stopPropagation()
        handler.current(code)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
