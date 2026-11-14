export interface SupabaseEnv {
  url: string
  publishableKey: string
}

export type EnvResult =
  | { ok: true; env: SupabaseEnv }
  | { ok: false; problems: string[] }

interface RawEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

/**
 * Valida la configuración de Supabase antes de crear el cliente.
 * Rechaza claves privilegiadas: en el navegador solo puede ir la clave pública.
 */
export function parseSupabaseEnv(raw: RawEnv): EnvResult {
  const problems: string[] = []
  const url = raw.VITE_SUPABASE_URL?.trim() ?? ''
  const key = raw.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

  if (!url) {
    problems.push('Falta VITE_SUPABASE_URL.')
  } else if (!isHttpUrl(url)) {
    problems.push('VITE_SUPABASE_URL no es una URL http(s) válida.')
  }

  if (!key) {
    problems.push('Falta VITE_SUPABASE_PUBLISHABLE_KEY.')
  } else if (isPrivilegedKey(key)) {
    problems.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY contiene una clave privilegiada (service_role o secreta). ' +
        'Quitala de inmediato y usá la clave pública.',
    )
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, env: { url, publishableKey: key } }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1] ?? ''))
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { role?: unknown }).role === 'service_role'
    )
  } catch {
    return false
  }
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return atob(padded)
}
