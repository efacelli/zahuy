import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { describedBy } from '../../components/ui/form-field-ids'
import { FormField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import {
  fetchSalesSettings,
  SALES_SETTINGS_KEY,
  settingsToForm,
  STORE_INFO_KEY,
  updateSalesSettings,
  validateSalesSettings,
  type SalesSettings,
  type SalesSettingsErrors,
  type SalesSettingsValues,
} from './sales-settings-api'
import styles from './Settings.module.css'

/** Redondeo, descuento por cantidad y datos del ticket (`sales_settings`). Rige para las ventas nuevas. */
export function SalesSettingsPanel() {
  const client = useSupabase()
  const settings = useQuery({ queryKey: SALES_SETTINGS_KEY, queryFn: () => fetchSalesSettings(client) })

  return (
    <section className={styles.section} aria-labelledby="sales-settings-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="sales-settings-title">Ventas y ticket</h2>
          <p className={styles.help}>
            Redondeo del total, descuento por cantidad que sugiere la caja y datos del comercio para el ticket. Los cambios
            valen para las ventas nuevas; las anteriores no se modifican.
          </p>
        </div>
      </div>
      {settings.isPending ? (
        <LoadingState label="Cargando configuración de ventas…" />
      ) : settings.error ? (
        <ErrorState message={toAppError(settings.error).message} onRetry={() => void settings.refetch()} />
      ) : settings.data === null ? (
        <p className={styles.muted}>La base todavía no tiene la configuración de ventas.</p>
      ) : (
        <SalesSettingsForm key={settings.data.id} settings={settings.data} />
      )}
    </section>
  )
}

function SalesSettingsForm({ settings }: { settings: SalesSettings }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [values, setValues] = useState<SalesSettingsValues>(() => settingsToForm(settings))
  const [errors, setErrors] = useState<SalesSettingsErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (update: Parameters<typeof updateSalesSettings>[2]) => updateSalesSettings(client, settings.id, update),
    onSuccess: async () => {
      // La caja vuelve a leer el redondeo, la regla de descuento y el encabezado del ticket.
      await Promise.all(
        [SALES_SETTINGS_KEY, STORE_INFO_KEY, ['rounding-multiple'], ['discount-rule']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
      toast.success('Se guardó la configuración de ventas.')
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const result = validateSalesSettings(values, settings.storeAvailable)
    setErrors(result.errors)
    if (result.update) save.mutate(result.update)
  }

  const field = (
    key: keyof SalesSettingsValues,
    label: string,
    { hint, required = true, numeric = true, disabled = false }: { hint?: string; required?: boolean; numeric?: boolean; disabled?: boolean },
  ) => (
    <FormField label={label} htmlFor={`sales-${key}`} required={required} hint={hint} error={errors[key]}>
      <input
        id={`sales-${key}`}
        className="input"
        inputMode={numeric ? 'decimal' : undefined}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(`sales-${key}`, { hint, error: errors[key] })}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      />
    </FormField>
  )

  const storeHint = settings.storeAvailable ? undefined : 'Se habilita cuando la base tenga los datos del comercio.'

  return (
    <form className={styles.salesForm} onSubmit={submit} noValidate>
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}

      <fieldset className={styles.fieldset}>
        <legend>Redondeo del total</legend>
        {field('rounding_multiple', 'Redondear a múltiplos de ($)', {
          hint: 'La caja sugiere el total redondeado (desde la mitad sube). Con menos de la mitad se cobra exacto.',
        })}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Descuento por cantidad</legend>
        <div className={styles.fieldRow}>
          {field('quantity_discount_step', 'Cada cuántas unidades', { hint: 'Por ejemplo, 6.' })}
          {field('quantity_discount_percent', 'Descuento por escalón (%)', { hint: '0 = sin descuento sugerido.' })}
          {field('quantity_discount_max_percent', 'Tope (%)', { hint: 'Máximo por línea, también si lo escribe el cajero.' })}
        </div>
        <p className={styles.muted}>No se sugiere en productos por kilo o litro. El cajero puede cambiarlo o quitarlo.</p>
      </fieldset>

      <fieldset className={styles.fieldset} disabled={!settings.storeAvailable}>
        <legend>Datos del comercio en el ticket</legend>
        {!settings.storeAvailable && <p className={styles.muted}>{storeHint}</p>}
        <div className={styles.fieldRow}>
          {field('store_name', 'Nombre', { required: false, numeric: false, hint: 'Si queda vacío, el ticket dice ZAHUY.' })}
          {field('store_address', 'Dirección', { required: false, numeric: false })}
          {field('store_tax_id', 'CUIT', {
            required: false,
            hint: 'Por ahora dejalo vacío, hasta que lo confirme el contador. Si se carga, aparece en el ticket.',
          })}
        </div>
        <p className={styles.muted}>El ticket sigue diciendo «NO VÁLIDO COMO FACTURA».</p>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  )
}
