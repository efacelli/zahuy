import { useRef, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { CATALOG_KINDS, CATALOGS, catalogFromSlug } from './catalog-config'
import { CatalogPanel } from './CatalogPanel'
import styles from './Catalogs.module.css'

/** Categorías, marcas y proveedores. La pestaña activa queda en la URL (`?tipo=`). */
export function CatalogsPage() {
  const [params, setParams] = useSearchParams()
  const active = catalogFromSlug(params.get('tipo'))
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function select(index: number) {
    const kind = CATALOG_KINDS[(index + CATALOG_KINDS.length) % CATALOG_KINDS.length] ?? 'categories'
    setParams({ tipo: CATALOGS[kind].slug }, { replace: true })
    tabRefs.current[kind]?.focus()
  }

  function onKeyDown(event: KeyboardEvent) {
    const index = CATALOG_KINDS.indexOf(active.kind)
    if (event.key === 'ArrowRight') select(index + 1)
    else if (event.key === 'ArrowLeft') select(index - 1)
    else return
    event.preventDefault()
  }

  return (
    <>
      <PageHeader
        title="Catálogos"
        description="Categorías, marcas y proveedores que se usan al cargar productos. No se borran: se desactivan."
      />
      <div className={styles.tabs} role="tablist" aria-label="Tipo de catálogo">
        {CATALOG_KINDS.map((kind) => {
          const info = CATALOGS[kind]
          const selected = kind === active.kind
          return (
            <button
              key={kind}
              ref={(el) => {
                tabRefs.current[kind] = el
              }}
              type="button"
              role="tab"
              id={`tab-${kind}`}
              aria-selected={selected}
              aria-controls={`panel-${kind}`}
              tabIndex={selected ? 0 : -1}
              className={`${styles.tab} ${selected ? styles.tabActive : ''}`}
              onClick={() => setParams({ tipo: info.slug }, { replace: true })}
              onKeyDown={onKeyDown}
            >
              {info.plural}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`panel-${active.kind}`} aria-labelledby={`tab-${active.kind}`} className={styles.panel}>
        <CatalogPanel key={active.kind} info={active} />
      </div>
    </>
  )
}
