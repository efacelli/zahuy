/**
 * "Enter pasa al siguiente campo", como en el sistema anterior: carga rápida
 * con teclado (y lector), sin ir al mouse. El último paso es el botón de enviar.
 */
const FIELDS =
  'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]), button[type="submit"]:not([disabled])'

export function focusNextField(from: HTMLElement): boolean {
  const form = from.closest('form')
  if (!form) return false
  const fields = Array.from(form.querySelectorAll<HTMLElement>(FIELDS)).filter(
    // Lo que está dentro de un bloque plegado (por ejemplo, la descripción) no cuenta.
    (el) => el === from || !el.closest('details:not([open])'),
  )
  const next = fields[fields.indexOf(from) + 1]
  if (!next) return false
  next.focus()
  return true
}

/** Para el onKeyDown del formulario: Enter en un campo de una línea avanza en lugar de enviar. */
export function enterMovesToNextField(event: React.KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement
  const isSingleLine =
    (target instanceof HTMLInputElement && !['submit', 'button', 'reset', 'file'].includes(target.type)) ||
    target instanceof HTMLSelectElement
  if (!isSingleLine) return
  event.preventDefault()
  focusNextField(target)
}
