/** Búsqueda en catálogos para el autocompletado (sin tildes ni mayúsculas). */

export interface Option {
  id: string
  name: string
}

export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Primero las que empiezan con lo escrito, después las que tienen una palabra
 * que empieza así y al final las que lo contienen en cualquier parte.
 */
export function filterOptions(options: Option[], text: string, limit = 50): Option[] {
  const q = normalizeName(text)
  if (q === '') return options.slice(0, limit)
  const scored: [Option, number][] = []
  for (const o of options) {
    const n = normalizeName(o.name)
    const score = n.startsWith(q) ? 0 : n.split(' ').some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1
    if (score >= 0) scored.push([o, score])
  }
  scored.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name, 'es'))
  return scored.slice(0, limit).map(([o]) => o)
}

export function exactMatch(options: Option[], text: string): Option | undefined {
  const q = normalizeName(text)
  return q === '' ? undefined : options.find((o) => normalizeName(o.name) === q)
}
