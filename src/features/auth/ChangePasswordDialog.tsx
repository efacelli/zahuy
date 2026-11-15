import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/toast-context'
import { useSupabase } from '../../lib/supabase-context'
import {
  MIN_PASSWORD_LENGTH,
  passwordErrorMessage,
  validateChangePassword,
  type ChangePasswordErrors,
  type ChangePasswordValues,
} from './password'
import styles from './ChangePasswordDialog.module.css'

interface ChangePasswordDialogProps {
  open: boolean
  email: string
  onClose: () => void
}

/**
 * Cada usuario cambia su propia contraseña. Primero se comprueba la actual
 * (volviendo a iniciar sesión con ella) para que nadie la cambie desde una
 * computadora que quedó abierta.
 */
export function ChangePasswordDialog({ open, email, onClose }: ChangePasswordDialogProps) {
  if (!open) return null
  return <ChangePasswordContent email={email} onClose={onClose} />
}

function ChangePasswordContent({ email, onClose }: { email: string; onClose: () => void }) {
  const client = useSupabase()
  const toast = useToast()
  const [values, setValues] = useState<ChangePasswordValues>({ current: '', next: '', repeat: '' })
  const [errors, setErrors] = useState<ChangePasswordErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (key: keyof ChangePasswordValues, value: string) => setValues((v) => ({ ...v, [key]: value }))

  async function submit() {
    setServerError(null)
    const next = validateChangePassword(values)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    try {
      const check = await client.auth.signInWithPassword({ email, password: values.current })
      if (check.error) {
        setServerError(passwordErrorMessage(check.error))
        return
      }
      const { error } = await client.auth.updateUser({ password: values.next })
      if (error) {
        setServerError(passwordErrorMessage(error))
        return
      }
      toast.success('Tu contraseña cambió. Usala la próxima vez que ingreses.')
      onClose()
    } catch {
      setServerError(passwordErrorMessage(null))
    } finally {
      setBusy(false)
    }
  }

  const field = (key: keyof ChangePasswordValues, label: string, autoComplete: string, hint?: string) => (
    <FormField label={label} htmlFor={`password-${key}`} required error={errors[key]} hint={hint}>
      <input
        id={`password-${key}`}
        type="password"
        className="input"
        autoComplete={autoComplete}
        aria-invalid={errors[key] ? true : undefined}
        value={values[key]}
        onChange={(e) => set(key, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
      />
    </FormField>
  )

  return (
    <Modal
      open
      size="sm"
      title="Cambiar mi contraseña"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Cambiar
          </Button>
        </>
      }
    >
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}
      <div className={styles.form}>
        {field('current', 'Contraseña actual', 'current-password')}
        {field('next', 'Contraseña nueva', 'new-password', `Al menos ${MIN_PASSWORD_LENGTH} caracteres, con letras y números.`)}
        {field('repeat', 'Repetir la contraseña nueva', 'new-password')}
      </div>
    </Modal>
  )
}
