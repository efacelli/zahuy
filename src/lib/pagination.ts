export const DEFAULT_PAGE_SIZE = 25

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Rango [desde, hasta] para `.range()` de Supabase (índices base 0, inclusivos). */
export function pageRange(page: number, pageSize: number): [number, number] {
  const from = (Math.max(1, page) - 1) * pageSize
  return [from, from + pageSize - 1]
}
