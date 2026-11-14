import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  /** Qué va a pasar, en términos concretos (producto, cantidad, lote...). */
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** `danger` para operaciones que restan stock o no se pueden deshacer fácilmente. */
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmación antes de operaciones que afectan stock (CLAUDE.md, UI). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
