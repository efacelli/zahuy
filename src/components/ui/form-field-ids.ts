/** Valor de `aria-describedby` para un control dentro de `<FormField>`. */
export function describedBy(id: string, { hint, error }: { hint?: string; error?: string | null }): string | undefined {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}
