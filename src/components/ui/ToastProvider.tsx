import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { ToastContext, type ToastApi, type ToastTone } from './toast-context'
import styles from './Toast.module.css'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

const DURATION_MS: Record<ToastTone, number> = { success: 5000, info: 5000, error: 10000 }
const ICON: Record<ToastTone, IconName> = { success: 'check', info: 'info', error: 'error' }
const TITLE: Record<ToastTone, string> = { success: 'Listo', info: 'Aviso', error: 'Error' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-3), { id, tone, message }])
      window.setTimeout(() => dismiss(id), DURATION_MS[tone])
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <Icon name={ICON[t.tone]} />
            <div className={styles.content}>
              <strong>{TITLE[t.tone]}</strong>
              <span>{t.message}</span>
            </div>
            <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Cerrar aviso">
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
