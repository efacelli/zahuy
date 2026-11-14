import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { vi } from 'vitest'

type Listener = (event: AuthChangeEvent, session: Session | null) => void

/** Sesión ficticia SOLO para pruebas automáticas. */
export function fakeSession(email = 'empleado@prueba.test'): Session {
  return {
    access_token: 'token-de-prueba',
    refresh_token: 'refresh-de-prueba',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-11-14T00:00:00Z',
    },
  }
}

/**
 * Doble de prueba del cliente de Supabase con solo la parte de Auth.
 * Permite simular ingreso, error, cierre y expiración de sesión.
 */
export function createFakeSupabase(initial: Session | null = null) {
  let session = initial
  const listeners = new Set<Listener>()
  const emit = (event: AuthChangeEvent) => listeners.forEach((l) => l(event, session))

  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    }),
    signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => {
      session = fakeSession(email)
      emit('SIGNED_IN')
      return { data: { session, user: session.user }, error: null }
    }),
    signOut: vi.fn(async () => {
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
  }

  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    /** Simula que la sesión terminó sola (token expirado o revocado). */
    expireSession() {
      session = null
      emit('SIGNED_OUT')
    },
  }
}
