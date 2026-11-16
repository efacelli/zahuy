import { useQuery } from '@tanstack/react-query'
import { useEffect, useReducer, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { isBarcodeLike, normalizeBarcode } from '../../domain/barcode'
import { SALE_UNIT_LABEL, isIntegerUnit } from '../../domain/units'
import { formatMoney } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { useBarcodeScanner } from '../barcode/useBarcodeScanner'
import { searchProducts } from '../movements/movements-api'
import { cartReducer, cartTotal, lineTotal, parseScanInput, quantityError, type CartProduct } from './cart'
import { CloseSessionDialog } from './CloseSessionDialog'
import { PaymentDialog, type CompletedSale } from './PaymentDialog'
import { fetchSellable, findSellableByBarcode, type OpenSession } from './pos-api'
import { SaleTicket } from './SaleTicket'
import styles from './Pos.module.css'

const SCAN_FIELD = 'pos-scan'
const focusScan = () => window.requestAnimationFrame(() => document.getElementById(SCAN_FIELD)?.focus())

export function SaleScreen({ session, onLeave }: { session: OpenSession; onLeave: () => void }) {
  const client = useSupabase()
  const [lines, dispatch] = useReducer(cartReducer, [])
  const [text, setText] = useState('')
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [paying, setPaying] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [closing, setClosing] = useState(false)
  const [ticket, setTicket] = useState<CompletedSale | null>(null)
  /** Una clave por carrito: si se corta la conexión al cobrar, reintentar no duplica la venta (§15.6). */
  const [saleKey, setSaleKey] = useState(newIdempotencyKey)
  const total = cartTotal(lines)

  const { quantity: multiplier, text: searchText } = parseScanInput(text)
  const isCode = isBarcodeLike(searchText)
  const results = useQuery({
    queryKey: ['pos-search', searchText],
    queryFn: () => searchProducts(client, searchText),
    enabled: searchText.length >= 2 && !isCode,
    staleTime: 30_000,
  })

  // F12 cobra desde cualquier lado de la pantalla.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F12' || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      if (lines.length > 0) setPaying(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lines.length])

  function add(product: CartProduct) {
    const quantity = multiplier ?? 1
    const problem = quantityError(quantity, product.sale_unit)
    if (problem) {
      setMessage({ tone: 'error', text: `${product.name}: ${problem}` })
      return
    }
    dispatch({ type: 'add', product, quantity })
    setMessage(null)
    setText('')
    focusScan()
  }

  // Si el foco quedó en un botón, el lector igual suma al carrito.
  useBarcodeScanner((code) => {
    findSellableByBarcode(client, code)
      .then((product) => {
        if (product) add(product)
        else setMessage({ tone: 'error', text: `No hay ningún producto activo con el código ${code}. Buscalo por nombre.` })
      })
      .catch((e: unknown) => setMessage({ tone: 'error', text: toAppError(e).message }))
  })

  async function onEnter() {
    if (searchText === '') {
      if (lines.length > 0 && text.trim() === '') setPaying(true)
      return
    }
    try {
      if (isCode) {
        const code = normalizeBarcode(searchText)
        const product = await findSellableByBarcode(client, code)
        if (product) add(product)
        else {
          setMessage({ tone: 'error', text: `No hay ningún producto activo con el código ${code}. Buscalo por nombre.` })
          setText('')
        }
        return
      }
      const only = results.data?.length === 1 ? results.data[0] : undefined
      if (only) add(await fetchSellable(client, only.id))
    } catch (e) {
      setMessage({ tone: 'error', text: toAppError(e).message })
    }
  }

  async function pick(productId: string) {
    try {
      add(await fetchSellable(client, productId))
    } catch (e) {
      setMessage({ tone: 'error', text: toAppError(e).message })
    }
  }

  function newSale() {
    dispatch({ type: 'clear' })
    setSaleKey(newIdempotencyKey())
    setTicket(null)
    setMessage(null)
    focusScan()
  }

  return (
    <>
      <PageHeader
        title={`Caja · ${session.cash_register_name}`}
        description="Escaneá los productos. Para varias unidades: cantidad, asterisco y código (3*779…). Enter con el campo vacío o F12 para cobrar."
        actions={
          <>
            <Button onClick={onLeave}>Cambiar de caja</Button>
            <Button onClick={() => setClosing(true)} disabled={lines.length > 0}>
              Cerrar caja
            </Button>
          </>
        }
      />

      <div className={styles.saleGrid}>
        <section className={styles.card} aria-label="Carrito">
          <div className={styles.scan}>
            <label htmlFor={SCAN_FIELD} className={styles.scanLabel}>
              Código o producto
            </label>
            <input
              id={SCAN_FIELD}
              type="search"
              className={`input ${styles.scanInput}`}
              autoComplete="off"
              placeholder="Escaneá o escribí el nombre"
              value={text}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- la caja vive en este campo: el lector escribe acá
              autoFocus
              onChange={(e) => {
                setMessage(null)
                setText(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void onEnter()
                }
              }}
            />
            {message && (
              <p className={message.tone === 'error' ? styles.scanError : styles.muted} role="alert">
                {message.text}
              </p>
            )}
            {!isCode && searchText.length >= 2 && (
              <ul className={styles.results} aria-label="Productos encontrados">
                {results.isPending && <li className={styles.muted}>Buscando…</li>}
                {results.data?.length === 0 && <li className={styles.muted}>No hay productos activos con ese texto.</li>}
                {results.data?.map((p) => (
                  <li key={p.id}>
                    <button type="button" className={styles.result} onClick={() => void pick(p.id)}>
                      <span>{p.name}</span>
                      <span className={styles.muted}>SKU {p.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lines.length === 0 ? (
            <p className={styles.empty}>
              <Icon name="inbox" size={28} />
              El carrito está vacío.
            </p>
          ) : (
            <table className={styles.cart} aria-label="Productos del carrito">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className={styles.num}>
                    Cantidad
                  </th>
                  <th scope="col" className={styles.num}>
                    Precio
                  </th>
                  <th scope="col" className={styles.num}>
                    Subtotal
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.product.id}>
                    <td>
                      {l.product.name}
                      <span className={styles.muted}> · SKU {l.product.sku}</span>
                    </td>
                    <td className={styles.num}>
                      <QuantityInput
                        label={`Cantidad de ${l.product.name}`}
                        value={l.quantity}
                        integer={isIntegerUnit(l.product.sale_unit)}
                        unit={SALE_UNIT_LABEL[l.product.sale_unit].toLowerCase()}
                        onChange={(quantity) => dispatch({ type: 'set', productId: l.product.id, quantity })}
                      />
                    </td>
                    <td className={styles.num}>{formatMoney(l.product.sale_price_with_vat)}</td>
                    <td className={styles.num}>
                      <strong>{formatMoney(lineTotal(l))}</strong>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Quitar ${l.product.name}`}
                        onClick={() => {
                          dispatch({ type: 'remove', productId: l.product.id })
                          focusScan()
                        }}
                      >
                        <Icon name="close" size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className={`${styles.card} ${styles.totals}`} aria-label="Total">
          <p className={styles.totalLabel}>Total</p>
          <p className={styles.total} aria-live="polite">
            {formatMoney(total)}
          </p>
          <p className={styles.muted}>
            {lines.length} {lines.length === 1 ? 'producto' : 'productos'}. Precios con IVA.
          </p>
          <Button variant="primary" className={styles.payButton} disabled={lines.length === 0} onClick={() => setPaying(true)}>
            Cobrar (F12)
          </Button>
          <Button variant="ghost" disabled={lines.length === 0} onClick={() => setConfirmClear(true)}>
            Vaciar carrito
          </Button>
          <p className={styles.notice}>Comprobante interno: no es factura.</p>
        </aside>
      </div>

      {paying && (
        <PaymentDialog
          session={session}
          lines={lines}
          total={total}
          idempotencyKey={saleKey}
          onCancel={() => {
            setPaying(false)
            focusScan()
          }}
          onDone={(sale) => {
            setPaying(false)
            setTicket(sale)
          }}
        />
      )}

      {ticket && <SaleTicket sale={ticket} registerName={session.cash_register_name} onNext={newSale} />}

      <ConfirmDialog
        open={confirmClear}
        title="Vaciar el carrito"
        confirmLabel="Vaciar"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          newSale()
        }}
      >
        Se quitan los {lines.length} productos del carrito. No se registra ninguna venta.
      </ConfirmDialog>

      {closing && <CloseSessionDialog session={session} onCancel={() => setClosing(false)} onClosed={onLeave} />}
    </>
  )
}

function QuantityInput({
  label,
  value,
  integer,
  unit,
  onChange,
}: {
  label: string
  value: number
  integer: boolean
  unit: string
  onChange: (quantity: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value).replace('.', ',')
  const commit = () => {
    if (draft === null) return
    const n = parseDecimalInput(draft)
    if (n !== null && n > 0 && (!integer || Number.isInteger(n))) onChange(n)
    setDraft(null)
  }
  return (
    <span className={styles.qty}>
      {integer && (
        <Button size="sm" variant="ghost" aria-label={`Restar uno: ${label}`} onClick={() => onChange(value - 1)}>
          −
        </Button>
      )}
      <input
        className={`input ${styles.qtyInput}`}
        inputMode="decimal"
        aria-label={`${label} (${unit})`}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            focusScan()
          }
        }}
      />
      {integer && (
        <Button size="sm" variant="ghost" aria-label={`Sumar uno: ${label}`} onClick={() => onChange(value + 1)}>
          +
        </Button>
      )}
    </span>
  )
}
