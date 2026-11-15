import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppRole } from '../../domain/roles'

/** Fila de `profiles` (contrato §5.1). El email vive en Supabase Auth y no se expone. */
export interface UserRow {
  id: string
  full_name: string
  role: AppRole
  is_active: boolean
}

const COLUMNS = 'id, full_name, role, is_active'

export async function listUsers(client: SupabaseClient): Promise<UserRow[]> {
  const { data, error } = await client.from('profiles').select(COLUMNS).order('full_name')
  if (error) throw error
  return (data ?? []) as UserRow[]
}

/**
 * Solo el dueño (`admin`) cambia nombre, rol o estado, y nunca los propios
 * (§5.1): lo garantizan RLS y el trigger `profiles_before_update`.
 */
export async function updateUser(
  client: SupabaseClient,
  id: string,
  values: Partial<Pick<UserRow, 'full_name' | 'role' | 'is_active'>>,
): Promise<UserRow> {
  const { data, error } = await client.from('profiles').update(values).eq('id', id).select(COLUMNS).single()
  if (error) {
    // 0 filas actualizadas (RLS) = sin permiso.
    if ((error as { code?: unknown }).code === 'PGRST116') throw { code: '42501', message: 'UPDATE_NO_ROWS' }
    throw error
  }
  return data as UserRow
}

export function validateFullName(raw: string): string | null {
  const t = raw.trim()
  if (t === '') return 'Ingresá el nombre.'
  if (t.length > 120) return 'El nombre admite hasta 120 caracteres.'
  return null
}
