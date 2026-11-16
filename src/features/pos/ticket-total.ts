import type { TicketData } from './TicketBody'

/**
 * Total que se cobró: el de los productos más el redondeo del efectivo. El
 * redondeo nunca aparece en el ticket (decisión de efacelli); queda en el listado
 * de ventas y en el control de caja.
 */
export function chargedTotal(ticket: Pick<TicketData, 'total' | 'rounding'>): number {
  return Math.round((ticket.total + ticket.rounding) * 100) / 100
}
