import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { useSupabase } from '../../lib/supabase-context'
import { MIN_PASSWORD_LENGTH, MUST_CHANGE_PASSWORD, passwordErrorMessage, validateNewPassword } from './password'
import styles from './FirstPasswordPage.module.css'

/**
 * Primer ingreso: la cuenta se creó con una contraseña inicial compartida, así
 * que antes de usar el sistema cada persona elige la suya. Sin mails ni códigos:
 * ya inició sesión con la inicial hace segundos. Al guardar se borra la marca
 * `must_change_password` de sus metadatos y entra normalmente.
 */
export function FirstPasswordPage({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const client = useSupabase()
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<{ next?: string; repeat?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setServerError(null)
    const found = validateNewPassword(next, repeat)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      const { error } = await client.auth.updateUser({ password: next, data: { [MUST_CHANGE_PASSWORD]: false } })
      if (error) setServerError(passwordErrorMessage(error))
    } catch {
      setServerError(passwordErrorMessage(null))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={(e) => void submit(e)} noValidate>
        <h1>Elegí tu contraseña</h1>
        <p className={styles.help}>
          Hola {name}. Tu cuenta se creó con una contraseña inicial. Antes de seguir, elegí una propia: es la que vas a
          usar desde ahora.
        </p>
        {serverError && (
          <p className={styles.error} role="alert">
            <Icon name="error" size={18} /> {serverError}
          </p>
        )}
        <FormField
          label="Contraseña nueva"
          htmlFor="first-password-next"
          required
          error={errors.next}
          hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres, con letras y números.`}
        >
          <input
            id="first-password-next"
            type="password"
            className="input"
            autoComplete="new-password"
            aria-invalid={errors.next ? true : undefined}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </FormField>
        <FormField label="Repetir la contraseña" htmlFor="first-password-repeat" required error={errors.repeat}>
          <input
            id="first-password-repeat"
            type="password"
            className="input"
            autoComplete="new-password"
            aria-invalid={errors.repeat ? true : undefined}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </FormField>
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onSignOut} disabled={busy}>
            Salir
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Guardar y entrar
          </Button>
        </div>
      </form>
    </main>
  )
}
