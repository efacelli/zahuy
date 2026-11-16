import { useSyncExternalStore } from 'react'

/*
 * Papel del ticket interno. Depende de la impresora conectada a cada equipo, así
 * que se recuerda en el navegador (comodidad por equipo, no un dato del negocio):
 * si el almacenamiento falla, se usa el valor por defecto.
 */

export type TicketPaper = '80mm' | '58mm' | 'comun'

export const TICKET_PAPERS: { value: TicketPaper; label: string }[] = [
  { value: '80mm', label: 'Térmica 80 mm' },
  { value: '58mm', label: 'Térmica 58 mm' },
  { value: 'comun', label: 'Hoja común' },
]

export const DEFAULT_TICKET_PAPER: TicketPaper = '80mm'

const STORAGE_KEY = 'zahuy.ticket.papel'
const listeners = new Set<() => void>()
let memory: TicketPaper | null = null

function isPaper(value: unknown): value is TicketPaper {
  return TICKET_PAPERS.some((p) => p.value === value)
}

export function readTicketPaper(): TicketPaper {
  if (memory) return memory
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isPaper(stored)) return stored
  } catch {
    // Sin almacenamiento: valor por defecto.
  }
  return DEFAULT_TICKET_PAPER
}

export function writeTicketPaper(paper: TicketPaper) {
  memory = paper
  try {
    window.localStorage.setItem(STORAGE_KEY, paper)
  } catch {
    // Queda solo en memoria hasta recargar.
  }
  for (const l of listeners) l()
}

/** Solo para pruebas: olvida el valor en memoria. */
export function resetTicketPaperMemory() {
  memory = null
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Papel elegido en este equipo; el selector y el ticket se mantienen sincronizados. */
export function useTicketPaper(): [TicketPaper, (paper: TicketPaper) => void] {
  const paper = useSyncExternalStore(subscribe, readTicketPaper, () => DEFAULT_TICKET_PAPER)
  return [paper, writeTicketPaper]
}

/**
 * Márgenes de página al imprimir. En las térmicas el largo y el corte los define
 * el controlador de la impresora; se imprime sin margen. La hoja común usa margen normal.
 */
export function pageRule(paper: TicketPaper): string {
  return paper === 'comun' ? '@page { margin: 12mm; }' : '@page { margin: 0; }'
}
