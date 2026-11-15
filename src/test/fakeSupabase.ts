import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { vi } from 'vitest'

type Listener = (event: AuthChangeEvent, session: Session | null) => void
type Row = Record<string, unknown>
type Result = { data: unknown; error: unknown }

export const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'

/** Sesión ficticia SOLO para pruebas automáticas. */
export function fakeSession(email = 'empleado@prueba.test', userMetadata: Record<string, unknown> = {}): Session {
  return {
    access_token: 'token-de-prueba',
    refresh_token: 'refresh-de-prueba',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: FAKE_USER_ID,
      email,
      app_metadata: {},
      user_metadata: userMetadata,
      aud: 'authenticated',
      created_at: '2026-11-14T00:00:00Z',
    },
  }
}

export interface RecordedWrite {
  table: string
  op: 'insert' | 'update' | 'delete'
  payload: Row
  filters: Record<string, unknown>
}

/**
 * Doble de prueba del cliente de Supabase: Auth, lecturas/escrituras de tablas y RPC.
 * Permite simular ingreso, expiración de sesión, tablas inexistentes y errores de la base.
 */
export interface FakeOptions {
  /** Rol del perfil del usuario de prueba (por defecto, encargado). */
  role?: 'admin' | 'manager' | 'staff'
  isActive?: boolean
}

export function createFakeSupabase(initial: Session | null = null, options: FakeOptions = {}) {
  let session = initial
  const listeners = new Set<Listener>()
  const emit = (event: AuthChangeEvent) => listeners.forEach((l) => l(event, session))

  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    }),
    signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
      // Contraseña que simula credenciales incorrectas.
      if (password === 'incorrecta') {
        return { data: { session: null, user: null }, error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } }
      }
      session = fakeSession(email)
      emit('SIGNED_IN')
      return { data: { session, user: session.user }, error: null }
    }),
    updateUser: vi.fn(async (attrs: { password?: string; data?: Record<string, unknown> }) => {
      if (session && attrs.data) {
        session = { ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, ...attrs.data } } }
        emit('USER_UPDATED')
      }
      return { data: { user: session?.user ?? null }, error: null }
    }),
    signOut: vi.fn(async () => {
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
  }

  /** Filas por tabla; `error` simula una tabla inexistente u otro fallo de lectura. */
  const tables: Record<string, { data: Row[] | null; error: unknown }> = {
    // Perfil del usuario de prueba (contrato §5.1); lo lee RequireAuth.
    profiles: {
      data: [
        {
          id: FAKE_USER_ID,
          full_name: 'Usuario de prueba',
          role: options.role ?? 'manager',
          is_active: options.isActive ?? true,
        },
      ],
      error: null,
    },
  }
  /** Resultado forzado para la próxima escritura en una tabla (por ejemplo, un 23505). */
  const writeResults: Record<string, Result> = {}
  const writes: RecordedWrite[] = []

  const from = vi.fn((table: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row = {}
    const filters: Record<string, unknown> = {}
    const ilikeFilters: Record<string, string> = {}
    const inFilters: Record<string, readonly unknown[]> = {}

    const runSelect = (): Result => {
      const entry = tables[table] ?? { data: [], error: null }
      if (entry.error || !entry.data) return { data: null, error: entry.error }
      // Copias: como la base real, cada lectura devuelve objetos nuevos.
      const rows = entry.data
        .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
        .filter((r) => Object.entries(ilikeFilters).every(([k, v]) => String(r[k] ?? '').toLowerCase() === v))
        .map((r) => ({ ...r }))
      return { data: rows, error: null, count: rows.length } as Result
    }

    const runWrite = (): Result => {
      writes.push({ table, op: op as 'insert' | 'update' | 'delete', payload, filters: { ...filters } })
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
      if (op === 'delete') {
        const index = rows.findIndex((r) => r.id === filters.id)
        if (index >= 0) rows.splice(index, 1)
        return { data: null, error: null }
      }
      if (op === 'update' && inFilters.id) {
        const ids = inFilters.id
        const matched = rows.filter((r) => ids.includes(r.id))
        matched.forEach((r) => Object.assign(r, payload))
        writes[writes.length - 1]!.filters = { ...filters, id: [...ids] }
        return { data: matched.map((r) => ({ id: r.id })), error: null }
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
      not: () => builder,
      ilike: (column: string, value: unknown) => {
        ilikeFilters[column] = String(value).toLowerCase()
        return builder
      },
      is: () => builder,
      // En lecturas se registra pero no se aplica; en un UPDATE por ids, sí.
      in: (column: string, values: readonly unknown[]) => {
        inFilters[column] = values
        return builder
      },
      order: () => builder,
      range: () => builder,
      limit: () => builder,
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
      delete: () => {
        op = 'delete'
        return builder
      },
      single: () => {
        if (op !== 'select') return Promise.resolve(runWrite())
        const result = runSelect()
        if (result.error) return Promise.resolve(result)
        const rows = result.data as Row[]
        return Promise.resolve(
          rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } },
        )
      },
      then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(op === 'select' ? runSelect() : runWrite()).then(resolve, reject),
    }
    return builder
  })

  /** Resultado de `rpc(nombre, params).single()`. */
  const rpcResults: Record<string, Result> = {}
  const rpc = vi.fn((name: string, _params?: unknown) => {
    const result = (): Result =>
      rpcResults[name] ?? {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${name}` },
      }
    // `.single()` para las RPC que devuelven una fila; `await rpc(...)` para las que devuelven varias.
    return {
      single: () => Promise.resolve(result()),
      then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    }
  })

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
