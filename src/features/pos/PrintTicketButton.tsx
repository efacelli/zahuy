import { Button } from '../../components/ui/Button'
import { TICKET_PAPERS, useTicketPaper, type TicketPaper } from './ticket-paper'
import styles from './Pos.module.css'

/** Elegir el papel (se recuerda en este equipo) e imprimir el ticket interno. */
export function PrintTicketButton() {
  const [paper, setPaper] = useTicketPaper()
  return (
    <span className={styles.printControls}>
      <label htmlFor="ticket-paper" className={styles.printLabel}>
        Papel
      </label>
      <select
        id="ticket-paper"
        className="select"
        value={paper}
        onChange={(e) => setPaper(e.target.value as TicketPaper)}
      >
        {TICKET_PAPERS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <Button onClick={() => window.print()}>Imprimir ticket</Button>
    </span>
  )
}
