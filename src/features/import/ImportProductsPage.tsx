import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { formatVatRate } from '../../domain/vat'
import { formatDate } from '../../lib/dates'
import { toAppError } from '../../lib/errors'
import { formatMoney, formatNumber } from '../../lib/format'
import { useSupabase } from '../../lib/supabase-context'
import {
  UNCLASSIFIED,
  ensureUnclassified,
  fetchExistingLegacyCodes,
  runImport,
  type ImportFailure,
  type ImportProgress,
} from './import-api'
import { decodeText, filterSince, parseLegacyFile, type LegacyItem, type ParsedLegacyFile } from './legacy-csv'
import styles from './ImportProductsPage.module.css'

/** P-26: por defecto, lo que tuvo cambios desde 2025. */
const DEFAULT_SINCE = '2025-01-01'
const PREVIEW_ROWS = 10
const MAX_LISTED = 50

type Phase = 'select' | 'review' | 'running' | 'done'

/** Importación de productos desde la exportación del sistema anterior (contrato v0.5.0, P-24 a P-26). */
export function ImportProductsPage() {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('select')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedLegacyFile | null>(null)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [since, setSince] = useState(DEFAULT_SINCE)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, created: 0, failures: [] })
  const [stoppedBy, setStoppedBy] = useState<string | null>(null)
  const stopRequested = useRef(false)

  const recent = useMemo(() => (parsed ? filterSince(parsed.items, since || null) : []), [parsed, since])
  const toImport = useMemo(() => recent.filter((i) => !existing.has(i.legacyCode.toUpperCase())), [recent, existing])
  const alreadyThere = recent.length - toImport.length
  const filteredOut = (parsed?.items.length ?? 0) - recent.length

  async function onFile(file: File | undefined) {
    if (!file) return
    setLoadError(null)
    setFileName(file.name)
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setLoadError('Elegí un archivo CSV. En Excel: Archivo → Guardar como → "CSV UTF-8" o "CSV (delimitado por comas)".')
      return
    }
    try {
      const [text, codes] = await Promise.all([file.arrayBuffer().then(decodeText), fetchExistingLegacyCodes(client)])
      const result = parseLegacyFile(text)
      if (result.totalRows === 0 && result.problems.length > 0) {
        setLoadError(result.problems[0]?.message ?? 'No se pudo leer el archivo.')
        return
      }
      setParsed(result)
      setExisting(codes)
      setPhase('review')
    } catch (e) {
      setLoadError(toAppError(e).message)
    }
  }

  async function start() {
    setConfirming(false)
    setPhase('running')
    stopRequested.current = false
    setProgress({ done: 0, created: 0, failures: [] })
    try {
      const ids = await ensureUnclassified(client)
      const result = await runImport(client, toImport, ids, setProgress, () => stopRequested.current)
      setProgress(result)
      setStoppedBy(result.stoppedBy ?? (stopRequested.current ? 'Se detuvo a pedido.' : null))
    } catch (e) {
      setStoppedBy(toAppError(e).message)
    }
    await queryClient.invalidateQueries({ queryKey: ['products'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    setPhase('done')
  }

  const previewColumns: Column<LegacyItem, 'code' | 'name' | 'cost' | 'final' | 'vat' | 'updated'>[] = [
    { key: 'code', header: 'Código anterior', render: (i) => i.legacyCode },
    { key: 'name', header: 'Nombre', render: (i) => i.name, minWidth: '14rem' },
    { key: 'cost', header: 'Costo s/IVA', align: 'end', render: (i) => formatMoney(i.costPrice) },
    { key: 'final', header: 'Precio final', align: 'end', render: (i) => formatMoney(i.finalPrice) },
    { key: 'vat', header: 'IVA', align: 'end', render: (i) => formatVatRate(i.vatRate) },
    { key: 'updated', header: 'Actualizado', render: (i) => (i.updatedOn ? formatDate(i.updatedOn) : '—') },
  ]

  return (
    <>
      <PageHeader
        title="Importar productos"
        description="Carga los productos exportados del sistema anterior. Se crean sin stock: el stock se ingresa después con su vencimiento."
        actions={<Link to="/productos">← Productos</Link>}
      />

      {phase === 'select' && (
        <section className={styles.card} aria-labelledby="import-how">
          <h2 id="import-how">Cómo preparar el archivo</h2>
          <ol className={styles.steps}>
            <li>Exportá la lista de productos del sistema anterior a Excel.</li>
            <li>
              En Excel: <strong>Archivo → Guardar como → CSV UTF-8</strong> (o “CSV delimitado por comas”).
            </li>
            <li>
              Tiene que tener las columnas <em>Codigo Propio, Descripcion, Costo, Iva, Publico</em> y, si está,{' '}
              <em>Fecha Actualizacion</em>.
            </li>
          </ol>
          <label className={styles.fileLabel}>
            <span>Archivo CSV</span>
            <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {loadError && (
            <p className={styles.error} role="alert">
              <Icon name="error" size={18} /> {loadError}
            </p>
          )}
        </section>
      )}

      {phase === 'review' && parsed && (
        <section className={styles.card} aria-labelledby="import-review">
          <h2 id="import-review">Revisión de {fileName}</h2>
          <label className={styles.since}>
            <span>Solo actualizados desde</span>
            <input type="date" className="input" value={since} onChange={(e) => setSince(e.target.value)} />
            <small>Vacío = todos. Lo que no se actualiza hace años suele estar discontinuado.</small>
          </label>
          <dl className={styles.summary}>
            <dt>Filas en el archivo</dt>
            <dd>{formatNumber(parsed.totalRows)}</dd>
            <dt>Con problemas (no se importan)</dt>
            <dd>{formatNumber(parsed.problems.length)}</dd>
            <dt>Sin cambios desde la fecha elegida</dt>
            <dd>{formatNumber(filteredOut)}</dd>
            <dt>Ya importados antes</dt>
            <dd>{formatNumber(alreadyThere)}</dd>
            <dt>
              <strong>A importar</strong>
            </dt>
            <dd>
              <strong>{formatNumber(toImport.length)}</strong>
            </dd>
          </dl>
          <p className={styles.note}>
            Todos quedan activos, por unidad, con categoría y marca “{UNCLASSIFIED}” para ordenar después. El precio final
            queda igual al del sistema anterior.
          </p>

          {parsed.problems.length > 0 && (
            <details className={styles.problems}>
              <summary>Ver filas con problemas ({formatNumber(parsed.problems.length)})</summary>
              <ul>
                {parsed.problems.slice(0, MAX_LISTED).map((p) => (
                  <li key={p.line}>
                    Fila {p.line}
                    {p.legacyCode ? ` (código ${p.legacyCode})` : ''}: {p.message}
                  </li>
                ))}
                {parsed.problems.length > MAX_LISTED && <li>y {parsed.problems.length - MAX_LISTED} más…</li>}
              </ul>
            </details>
          )}

          <DataTable
            caption={`Vista previa (primeros ${PREVIEW_ROWS})`}
            columns={previewColumns}
            rows={toImport.slice(0, PREVIEW_ROWS)}
            rowKey={(i) => i.legacyCode}
            emptyTitle="No hay productos nuevos para importar"
          />

          <div className={styles.actions}>
            <Button
              onClick={() => {
                setParsed(null)
                setPhase('select')
              }}
            >
              Elegir otro archivo
            </Button>
            <Button variant="primary" disabled={toImport.length === 0} onClick={() => setConfirming(true)}>
              Importar {formatNumber(toImport.length)} productos
            </Button>
          </div>
        </section>
      )}

      {(phase === 'running' || phase === 'done') && (
        <section className={styles.card} aria-labelledby="import-progress">
          <h2 id="import-progress">{phase === 'running' ? 'Importando…' : 'Importación terminada'}</h2>
          <progress
            className={styles.bar}
            max={Math.max(toImport.length, 1)}
            value={progress.done}
            aria-label="Avance de la importación"
          />
          <p aria-live="polite">
            {formatNumber(progress.done)} de {formatNumber(toImport.length)} · creados {formatNumber(progress.created)} ·
            con error {formatNumber(progress.failures.length)}
          </p>
          {phase === 'running' && (
            <Button onClick={() => (stopRequested.current = true)}>Detener</Button>
          )}
          {phase === 'done' && (
            <>
              {stoppedBy && (
                <p className={styles.error} role="alert">
                  <Icon name="warning" size={18} /> Se detuvo: {stoppedBy} Podés volver a importar el mismo archivo: lo ya
                  creado no se duplica.
                </p>
              )}
              <FailureList failures={progress.failures} />
              <div className={styles.actions}>
                <Link to="/productos">Ver productos</Link>
                <Button
                  onClick={() => {
                    setParsed(null)
                    setPhase('select')
                  }}
                >
                  Importar otro archivo
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        title="Confirmar importación"
        confirmLabel={`Importar ${formatNumber(toImport.length)}`}
        onConfirm={() => void start()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          Se van a crear <strong>{formatNumber(toImport.length)} productos</strong> sin stock, con categoría y marca “
          {UNCLASSIFIED}”. Puede tardar unos minutos; no cierres esta pestaña. Si se corta, se puede repetir sin duplicar.
        </p>
      </ConfirmDialog>
    </>
  )
}

function FailureList({ failures }: { failures: ImportFailure[] }) {
  if (failures.length === 0) return null
  return (
    <details className={styles.problems} open>
      <summary>Productos que no se pudieron crear ({formatNumber(failures.length)})</summary>
      <ul>
        {failures.slice(0, MAX_LISTED).map((f) => (
          <li key={f.item.legacyCode}>
            Código {f.item.legacyCode} ({f.item.name}): {f.message}
          </li>
        ))}
        {failures.length > MAX_LISTED && <li>y {failures.length - MAX_LISTED} más…</li>}
      </ul>
    </details>
  )
}
