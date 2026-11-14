import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseSupabaseEnv, type EnvResult } from './env'

/**
 * Cliente único de Supabase para el navegador.
 * Usa solo la clave pública; los permisos reales los define la RLS en la base.
 *
 * Cuando el backend publique los tipos generados (src/types/database.ts),
 * este cliente pasa a ser `SupabaseClient<Database>`.
 */
export const supabaseConfig: EnvResult = parseSupabaseEnv(import.meta.env)

export const supabase: SupabaseClient | null = supabaseConfig.ok
  ? createClient(supabaseConfig.env.url, supabaseConfig.env.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/** Devuelve el cliente o lanza un error claro si la app no está configurada. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase no está configurado. Revisá el archivo .env.local.')
  }
  return supabase
}
