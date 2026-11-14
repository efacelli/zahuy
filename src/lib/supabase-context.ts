import type { SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

/** Cliente de Supabase disponible para toda la app (inyectable en pruebas). */
export const SupabaseContext = createContext<SupabaseClient | null>(null)

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error('useSupabase debe usarse dentro de <SupabaseContext.Provider>.')
  return client
}
