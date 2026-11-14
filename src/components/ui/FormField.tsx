import type { ReactNode } from 'react'
import styles from './FormField.module.css'

interface FormFieldProps {
  label: string
  htmlFor: string
  required?: boolean
  hint?: string
  error?: string | null
  children: ReactNode
}

/**
 * Etiqueta + control + ayuda + error. El control debe usar
 * `aria-describedby={describedBy(htmlFor, …)}` (form-field-ids.ts) y `aria-invalid` cuando hay error.
 */
export function FormField({ label, htmlFor, required = false, hint, error, children }: FormFieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {required ? (
          <span className={styles.required}>
            {' '}
            * <span className="visually-hidden">(obligatorio)</span>
          </span>
        ) : (
          <span className={styles.optional}> (opcional)</span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
