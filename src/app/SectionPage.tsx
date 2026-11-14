import { EmptyState } from '../components/ui/States'
import { PageHeader } from '../components/ui/PageHeader'
import type { NavItem } from './navigation'

interface SectionPageProps {
  item: NavItem
  /** Qué va a mostrar la sección cuando esté conectada. */
  upcoming: string[]
}

/**
 * Sección todavía no conectada a Supabase. No muestra datos inventados:
 * explica qué va a contener y de qué depende.
 */
export function SectionPage({ item, upcoming }: SectionPageProps) {
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <EmptyState
        icon={item.icon}
        title="Sección en preparación"
        description={
          <>
            <p>Se habilita cuando el backend publique el esquema de la base. Va a incluir:</p>
            <ul style={{ textAlign: 'start' }}>
              {upcoming.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        }
      />
    </>
  )
}
