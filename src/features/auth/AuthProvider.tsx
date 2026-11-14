import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AuthContext, type AuthState, type AuthStatus, type SignedOutReason } from './auth-context'
import { toAuthError } from './auth-errors'

interface AuthProviderProps {
  /** Cliente de Supabase (se inyecta para poder probarlo). */
  client: SupabaseClient
  children: ReactNode
}

/**
 * Mantiene la sesión de Supabase Auth.
 * La sesión solo dice quién es el usuario; qué puede hacer lo decide la RLS en la base.
 * Cuando exista `profiles` (contrato §5.1), acá se carga el rol y se bloquea a usuarios inactivos.
 */
export function AuthProvider({ client, children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [signedOutReason, setSignedOutReason] = useState<SignedOutReason>(null)
  const manualSignOut = useRef(false)

  useEffect(() => {
    let active = true

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
        setStatus(data.session ? 'signedIn' : 'signedOut')
      })
      .catch(() => {
        if (!active) return
        setSession(null)
        setStatus('signedOut')
      })

    // No hacer llamadas a Supabase dentro de este callback (recomendación de supabase-js).
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setStatus(nextSession ? 'signedIn' : 'signedOut')
      if (event === 'SIGNED_IN') {
        setSignedOutReason(null)
      } else if (event === 'SIGNED_OUT') {
        setSignedOutReason(manualSignOut.current ? 'manual' : 'expired')
        manualSignOut.current = false
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [client])

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
        return error ? toAuthError(error) : null
      } catch (error) {
        return toAuthError(error)
      }
    },
    [client],
  )

  const signOut = useCallback(async () => {
    manualSignOut.current = true
    try {
      // 'local': cierra la sesión en este dispositivo, aunque falle la red.
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) {
        manualSignOut.current = false
        return toAuthError(error)
      }
      return null
    } catch (error) {
      manualSignOut.current = false
      return toAuthError(error)
    }
  }, [client])

  const value = useMemo<AuthState>(
    () => ({ status, session, user: session?.user ?? null, signedOutReason, signIn, signOut }),
    [status, session, signedOutReason, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
