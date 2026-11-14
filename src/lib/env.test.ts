import { describe, expect, it } from 'vitest'
import { isPrivilegedKey, parseSupabaseEnv } from './env'

function fakeJwt(payload: object): string {
  const encode = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.firma`
}

describe('parseSupabaseEnv', () => {
  it('acepta URL y clave pública', () => {
    const result = parseSupabaseEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
    })
    expect(result).toEqual({
      ok: true,
      env: { url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_abc' },
    })
  })

  it('informa cuando faltan las variables', () => {
    const result = parseSupabaseEnv({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems).toHaveLength(2)
  })

  it('rechaza una URL inválida', () => {
    const result = parseSupabaseEnv({ VITE_SUPABASE_URL: 'ftp://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })
    expect(result.ok).toBe(false)
  })

  it('rechaza una clave secreta nueva (sb_secret_)', () => {
    const result = parseSupabaseEnv({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_123',
    })
    expect(result.ok).toBe(false)
  })

  it('rechaza una clave JWT con rol service_role', () => {
    const result = parseSupabaseEnv({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: fakeJwt({ role: 'service_role' }),
    })
    expect(result.ok).toBe(false)
  })
})

describe('isPrivilegedKey', () => {
  it('no marca la clave anon como privilegiada', () => {
    expect(isPrivilegedKey(fakeJwt({ role: 'anon' }))).toBe(false)
  })

  it('no falla con un JWT malformado', () => {
    expect(isPrivilegedKey('a.%%%.c')).toBe(false)
  })
})
