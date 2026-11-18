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
import styles from '../settings/Settings.module.css'
import {
  FISCAL_SETTINGS_KEY,
  fetchFiscalSettings,
  issuerMissing,
  saveFiscalSettings,
  settingsToForm,
  validateFiscalSettings,
  type FiscalSettings,
  type FiscalSettingsErrors,
  type FiscalSettingsForm,
} from './billing-api'

/** Facturación electrónica ARCA (`fiscal_settings`, contrato §22): ambiente, punto de venta y datos del emisor. */
export function FiscalSettingsPanel() {
  const client = useSupabase()
  const settings = useQuery({ queryKey: FISCAL_SETTINGS_KEY, queryFn: () => fetchFiscalSettings(client) })
  return (
    <section className={styles.section} aria-labelledby="fiscal-settings-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="fiscal-settings-title">Facturación electrónica</h2>
          <p className={styles.help}>
            Activa la factura electrónica de ARCA en el detalle de cada venta y guarda los datos del emisor que van impresos
            en la factura. Por ahora solo funciona en el ambiente de prueba (homologación), sin validez fiscal.
          </p>
        </div>
      </div>
      {settings.isPending ? (
        <LoadingState label="Cargando configuración fiscal…" />
      ) : settings.error ? (
        <ErrorState message={toAppError(settings.error).message} onRetry={() => void settings.refetch()} />
      ) : settings.data === null ? (
        <p className={styles.muted}>La base todavía no tiene la facturación electrónica.</p>
      ) : (
        <FiscalSettingsFormView key={settings.data.id} settings={settings.data} />
      )}
    </section>
  )
}

function FiscalSettingsFormView({ settings }: { settings: FiscalSettings }) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [values, setValues] = useState<FiscalSettingsForm>(() => settingsToForm(settings))
  const [errors, setErrors] = useState<FiscalSettingsErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (update: Record<string, unknown>) => saveFiscalSettings(client, settings.id, update),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FISCAL_SETTINGS_KEY })
      toast.success('Se guardó la configuración fiscal.')
    },
    onError: (e) => setServerError(toAppError(e).message),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const result = validateFiscalSettings(values, settings.issuerAvailable)
    setErrors(result.errors)
    if (result.update) save.mutate(result.update)
  }

  const missing = values.environment !== 'off' && settings.issuerAvailable ? issuerMissing({ ...settings, ...toIssuer(values) }) : []

  const field = (
    key: keyof FiscalSettingsForm,
    label: string,
    { hint, required = false, type }: { hint?: string; required?: boolean; type?: string } = {},
  ) => (
    <FormField label={label} htmlFor={`fiscal-${key}`} required={required} hint={hint} error={errors[key]}>
      <input
        id={`fiscal-${key}`}
        className="input"
        type={type}
        autoComplete="off"
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(`fiscal-${key}`, { hint, error: errors[key] })}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      />
    </FormField>
  )

  return (
    <form className={styles.salesForm} onSubmit={submit} noValidate>
      {serverError && (
        <p className={styles.serverError} role="alert">
          <Icon name="error" size={18} /> {serverError}
        </p>
      )}

      <fieldset className={styles.fieldset}>
        <legend>Ambiente</legend>
        <FormField label="Facturación" htmlFor="fiscal-environment">
          <select
            id="fiscal-environment"
            className="select"
            value={values.environment}
            onChange={(e) => setValues((v) => ({ ...v, environment: e.target.value as FiscalSettingsForm['environment'] }))}
          >
            <option value="off">Apagada: la caja no factura</option>
            <option value="homologacion">Prueba (homologación): sin validez fiscal</option>
            {settings.environment === 'produccion' && <option value="produccion">Producción (se cambia aparte)</option>}
          </select>
        </FormField>
        <div className={styles.fieldRow}>
          {field('pto_vta', 'Punto de venta', { hint: 'El de «RECE para aplicativo y web services».' })}
          {field('caea_pto_vta', 'Punto de venta de CAEA', { hint: 'Opcional: solo para la contingencia.' })}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset} disabled={!settings.issuerAvailable}>
        <legend>Datos del emisor en la factura</legend>
        {!settings.issuerAvailable && <p className={styles.muted}>Se habilita cuando la base tenga los datos del emisor.</p>}
        <div className={styles.fieldRow}>
          {field('issuer_name', 'Razón social')}
          {field('issuer_tax_id', 'CUIT', { hint: '11 dígitos, sin guiones.' })}
          {field('issuer_address', 'Domicilio comercial')}
        </div>
        <div className={styles.fieldRow}>
          {field('gross_income_number', 'Ingresos Brutos')}
          {field('activity_start_date', 'Inicio de actividades', { type: 'date' })}
        </div>
        {missing.length > 0 && (
          <p className={styles.muted} role="status">
            Para que la factura salga completa falta: {missing.join(', ')}.
          </p>
        )}
      </fieldset>

      <div>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  )
}

const toIssuer = (v: FiscalSettingsForm) => ({
  issuer_name: v.issuer_name.trim() || null,
  issuer_tax_id: v.issuer_tax_id.trim() || null,
  issuer_address: v.issuer_address.trim() || null,
  gross_income_number: v.gross_income_number.trim() || null,
  activity_start_date: v.activity_start_date.trim() || null,
})
