import type { SupabaseClient } from '@supabase/supabase-js'

/** Fila de `expiry_alert_settings` (contrato §5.9). `category_id` nulo = configuración general. */
export interface AlertSettingRow {
  id: string
  category_id: string | null
  urgent_days: number
  soon_days: number
  notice_days: number
}

export interface AlertDaysValues {
  urgent_days: string
  soon_days: string
  notice_days: string
}

export type AlertDaysErrors = Partial<Record<keyof AlertDaysValues, string>>

const COLUMNS = 'id, category_id, urgent_days, soon_days, notice_days'
const MAX_NOTICE_DAYS = 365

export async function listAlertSettings(client: SupabaseClient): Promise<AlertSettingRow[]> {
  const { data, error } = await client.from('expiry_alert_settings').select(COLUMNS)
  if (error) throw error
  return (data ?? []) as AlertSettingRow[]
}

export async function createAlertSetting(
  client: SupabaseClient,
  categoryId: string,
  days: { urgent_days: number; soon_days: number; notice_days: number },
): Promise<AlertSettingRow> {
  const { data, error } = await client
    .from('expiry_alert_settings')
    .insert({ category_id: categoryId, ...days })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as AlertSettingRow
}

export async function updateAlertSetting(
  client: SupabaseClient,
  id: string,
  days: { urgent_days: number; soon_days: number; notice_days: number },
): Promise<AlertSettingRow> {
  const { data, error } = await client.from('expiry_alert_settings').update(days).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return data as AlertSettingRow
}

/** Quita la excepción de una categoría: vuelve a usar la configuración general (§5.9). Queda auditado (P-22). */
export async function deleteAlertSetting(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('expiry_alert_settings').delete().eq('id', id)
  if (error) throw error
}

export function daysToForm(row: Pick<AlertSettingRow, 'urgent_days' | 'soon_days' | 'notice_days'>): AlertDaysValues {
  return { urgent_days: String(row.urgent_days), soon_days: String(row.soon_days), notice_days: String(row.notice_days) }
}

function parseDays(raw: string): number | null {
  const t = raw.trim()
  return /^\d{1,3}$/.test(t) ? Number(t) : null
}

/**
 * Mismas reglas que los CHECK de la base (§5.9): enteros, urgente ≥ 0,
 * pronto ≥ urgente, aviso ≥ pronto y aviso ≤ 365. La base vuelve a validar.
 */
export function validateAlertDays(v: AlertDaysValues): {
  errors: AlertDaysErrors
  days: { urgent_days: number; soon_days: number; notice_days: number } | null
} {
  const errors: AlertDaysErrors = {}
  const urgent = parseDays(v.urgent_days)
  const soon = parseDays(v.soon_days)
  const notice = parseDays(v.notice_days)
  if (urgent === null) errors.urgent_days = 'Ingresá un número entero de días (0 o más).'
  if (soon === null) errors.soon_days = 'Ingresá un número entero de días.'
  if (notice === null) errors.notice_days = 'Ingresá un número entero de días.'
  if (urgent !== null && soon !== null && soon < urgent) errors.soon_days = 'Tiene que ser igual o mayor que los días de "urgente".'
  if (soon !== null && notice !== null && notice < soon) errors.notice_days = 'Tiene que ser igual o mayor que los días de "vence pronto".'
  if (notice !== null && notice > MAX_NOTICE_DAYS) errors.notice_days = `Como máximo ${MAX_NOTICE_DAYS} días.`
  const ok = Object.keys(errors).length === 0 && urgent !== null && soon !== null && notice !== null
  return { errors, days: ok ? { urgent_days: urgent, soon_days: soon, notice_days: notice } : null }
}
