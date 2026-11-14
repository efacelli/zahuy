import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { AppError } from '../../lib/errors'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

/** Por qué no hay sesión: el usuario salió, o la sesión terminó sola (expiró o se revocó). */
export type SignedOutReason = 'manual' | 'expired' | null

export interface AuthState {
  status: AuthStatus
  session: Session | null
  user: User | null
  signedOutReason: SignedOutReason
  /** Devuelve `null` si ingresó, o el error listo para mostrar. */
  signIn: (email: string, password: string) => Promise<AppError | null>
  signOut: () => Promise<AppError | null>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  return value
}
