import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import logo from '../../assets/brand/zahuy-logo.png'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { describedBy } from '../../components/ui/form-field-ids'
import { Icon } from '../../components/ui/Icon'
import { LoadingState } from '../../components/ui/States'
import { useAuth } from './auth-context'
import { safeRedirectPath } from './redirect'
import styles from './LoginPage.module.css'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresá tu email.').pipe(z.email('El email no es válido.')),
  password: z.string().min(1, 'Ingresá tu contraseña.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { status, signIn, signedOutReason } = useAuth()
  const [params] = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  if (status === 'loading') return <LoadingState label="Verificando sesión…" />
  if (status === 'signedIn') return <Navigate to={safeRedirectPath(params.get('volver'))} replace />

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setServerError(null)
    const error = await signIn(email, password)
    if (error) setServerError(error.message)
  })

  const emailError = errors.email?.message
  const passwordError = errors.password?.message

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <img src={logo} alt="Zahuy Autoservicio" className={styles.logo} width={340} height={183} />
        <h1 className={styles.title}>Ingresar al sistema</h1>

        {signedOutReason === 'expired' && !serverError && (
          <p className={styles.notice} role="status">
            <Icon name="info" size={18} /> Tu sesión terminó. Volvé a ingresar para continuar.
          </p>
        )}
        {serverError && (
          <p className={styles.error} role="alert">
            <Icon name="error" size={18} /> {serverError}
          </p>
        )}

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <FormField label="Email" htmlFor="login-email" required error={emailError}>
            <input
              id="login-email"
              type="email"
              className="input"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={describedBy('login-email', { error: emailError })}
              {...register('email')}
            />
          </FormField>

          <FormField label="Contraseña" htmlFor="login-password" required error={passwordError}>
            <div className={styles.passwordRow}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="input"
                autoComplete="current-password"
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={describedBy('login-password', { error: passwordError })}
                {...register('password')}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-controls="login-password"
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </Button>
            </div>
          </FormField>

          <Button type="submit" variant="primary" loading={isSubmitting} className={styles.submit}>
            Ingresar
          </Button>
        </form>

        <p className={styles.help}>
          ¿No podés ingresar? Pedile al encargado que revise tu usuario. Las cuentas las crea el administrador.
        </p>
      </div>
    </main>
  )
}
