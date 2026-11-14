import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { vi } from 'vitest'

type Listener = (event: AuthChangeEvent, session: Session | null) => void
type Row = Record<string, unknown>
type Result = { data: unknown; error: unknown }

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

export interface RecordedWrite {
  table: string
  op: 'insert' | 'update'
  payload: Row
  filters: Record<string, unknown>
}

/**
 * Doble de prueba del cliente de Supabase: Auth, lecturas/escrituras de tablas y RPC.
 * Permite simular ingreso, expiración de sesión, tablas inexistentes y errores de la base.
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

  /** Filas por tabla; `error` simula una tabla inexistente u otro fallo de lectura. */
  const tables: Record<string, { data: Row[] | null; error: unknown }> = {}
  /** Resultado forzado para la próxima escritura en una tabla (por ejemplo, un 23505). */
  const writeResults: Record<string, Result> = {}
  const writes: RecordedWrite[] = []

  const from = vi.fn((table: string) => {
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const filters: Record<string, unknown> = {}

    const runSelect = (): Result => {
      const entry = tables[table] ?? { data: [], error: null }
      if (entry.error || !entry.data) return { data: null, error: entry.error }
      // Copias: como la base real, cada lectura devuelve objetos nuevos.
      const rows = entry.data.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)).map((r) => ({ ...r }))
      return { data: rows, error: null, count: rows.length } as Result
    }

    const runWrite = (): Result => {
      writes.push({ table, op: op as 'insert' | 'update', payload, filters: { ...filters } })
      const forced = writeResults[table]
      if (forced) {
        delete writeResults[table]
        return forced
      }
      const entry = (tables[table] ??= { data: [], error: null })
      const rows = entry.data ?? []
      if (op === 'insert') {
        const row = { id: `00000000-0000-4000-8000-${String(rows.length + 100).padStart(12, '0')}`, is_active: true, ...payload }
        rows.push(row)
        return { data: { ...row }, error: null }
      }
      const row = rows.find((r) => r.id === filters.id)
      if (!row) return { data: null, error: { code: 'PGRST116', message: 'No rows' } }
      Object.assign(row, payload)
      return { data: { ...row }, error: null }
    }

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return builder
      },
      // Se registran pero no se aplican: la lógica de filtros se prueba aparte (list-api.test).
      or: () => builder,
      is: () => builder,
      in: () => builder,
      order: () => builder,
      range: () => builder,
      insert: (values: Row) => {
        op = 'insert'
        payload = values
        return builder
      },
      update: (values: Row) => {
        op = 'update'
        payload = values
        return builder
      },
      single: () => Promise.resolve(op === 'select' ? runSelect() : runWrite()),
      then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(op === 'select' ? runSelect() : runWrite()).then(resolve, reject),
    }
    return builder
  })

  /** Resultado de `rpc(nombre, params).single()`. */
  const rpcResults: Record<string, Result> = {}
  const rpc = vi.fn((name: string, _params?: unknown) => ({
    single: () =>
      Promise.resolve(
        rpcResults[name] ?? {
          data: null,
          error: { code: 'PGRST202', message: `Could not find the function public.${name}` },
        },
      ),
  }))

  return {
    client: { auth, from, rpc } as unknown as SupabaseClient,
    auth,
    from,
    rpc,
    writes,
    setTable(table: string, data: Row[] | null, error: unknown = null) {
      tables[table] = { data, error }
    },
    failNextWrite(table: string, error: unknown) {
      writeResults[table] = { data: null, error }
    },
    setRpcResult(name: string, data: unknown, error: unknown = null) {
      rpcResults[name] = { data, error }
    },
    /** Simula que la sesión terminó sola (token expirado o revocado). */
    expireSession() {
      session = null
      emit('SIGNED_OUT')
    },
  }
}
