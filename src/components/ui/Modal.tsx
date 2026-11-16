import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Mientras es true, no se puede cerrar (por ejemplo, durante un envío). */
  busy?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, title, onClose, children, footer, busy = false, size = 'md' }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)

  useLayoutEffect(() => {
    onCloseRef.current = onClose
    busyRef.current = busy
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Primero el contenido (por ejemplo, el primer campo de un formulario); si no tiene
    // nada enfocable, el primer botón del pie (en una confirmación, "Cancelar").
    const first =
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? footerRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (items.length === 0) return
        const firstItem = items[0]
        const lastItem = items[items.length - 1]
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault()
          lastItem?.focus()
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault()
          firstItem?.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      // Devuelve el foco a donde estaba, salvo que la pantalla ya lo haya movido a
      // otro lado (por ejemplo, al buscador para el próximo producto): si no, el
      // foco vuelve al botón que abrió el diálogo y el próximo escaneo se pierde.
      const active = document.activeElement
      const focusIsFree = !active || active === document.body || (panel?.contains(active) ?? false)
      if (focusIsFree) previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    // Clic en el fondo = cerrar. Con teclado se cierra con Escape (manejado arriba).
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={panelRef}
        className={`${styles.panel} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        <div ref={bodyRef} className={styles.body}>
          {children}
        </div>
        {footer && (
          <footer ref={footerRef} className={styles.footer}>
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
