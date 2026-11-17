import { useQuery } from '@tanstack/react-query'
import { useEffect, useReducer, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { isBarcodeLike, normalizeBarcode, parseScaleLabel, type ScaleLabel } from '../../domain/barcode'
import { DEFAULT_DISCOUNT_RULE, discountError, type DiscountRule } from '../../domain/quantity-discount'
import { SALE_UNIT_LABEL, isIntegerUnit } from '../../domain/units'
import { formatMoney, formatNumber } from '../../lib/format'
import { toAppError } from '../../lib/errors'
import { newIdempotencyKey } from '../../lib/idempotency'
import { parseDecimalInput } from '../../lib/numbers'
import { useSupabase } from '../../lib/supabase-context'
import { useBarcodeScanner } from '../barcode/useBarcodeScanner'
import { searchProducts } from '../movements/movements-api'
import { cartReducer, lineName, mixError, parseScanInput, priceCart, quantityError, type CartProduct } from './cart'
import { CloseSessionDialog } from './CloseSessionDialog'
import { PaymentDialog, type CompletedSale } from './PaymentDialog'
import { FreeItemDialog } from './FreeItemDialog'
import { fetchDiscountRule, fetchSellable, findSellableByBarcode, supportsManualLines, type OpenSession } from './pos-api'
import { ScaleItemDialog } from './ScaleItemDialog'
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
  const rule = useQuery({ queryKey: ['discount-rule'], queryFn: () => fetchDiscountRule(client), staleTime: 300_000 })
  const discountRule = rule.data ?? DEFAULT_DISCOUNT_RULE
  const cart = priceCart(lines, discountRule)
  /** §20: sin la migración la base cobraría el precio de lista, así que no se ofrece. */
  const manual = useQuery({ queryKey: ['pos-manual-support'], queryFn: () => supportsManualLines(client), staleTime: 300_000 })
  const manualEnabled = manual.data === true
  const [scale, setScale] = useState<{ label: ScaleLabel | null; repeated: boolean } | null>(null)
  const [freeOpen, setFreeOpen] = useState(false)
  const total = cart.total

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
    const problem = mixError(lines, product.id, 'product') ?? quantityError(quantity, product.sale_unit)
    if (problem) {
      setMessage({ tone: 'error', text: `${product.name}: ${problem}` })
      return
    }
    dispatch({ type: 'add', product, quantity })
    setMessage(null)
    setText('')
    focusScan()
  }

  /** Primero se busca el código entre los productos; si no está, puede ser una etiqueta de balanza (§20.1). */
  async function handleCode(code: string) {
    const product = await findSellableByBarcode(client, code)
    if (product) return add(product)
    setText('')
    const label = parseScaleLabel(code)
    if (!label) {
      setMessage({ tone: 'error', text: `No hay ningún producto activo con el código ${code}. Buscalo por nombre.` })
      return
    }
    if (!manualEnabled) {
      setMessage({ tone: 'error', text: 'Las etiquetas de balanza todavía no están habilitadas en la base.' })
      return
    }
    setMessage(null)
    setScale({ label, repeated: lines.some((l) => l.kind === 'manual' && l.barcode === label.code) })
  }

  // Si el foco quedó en un botón, el lector igual suma al carrito.
  useBarcodeScanner((code) => {
    if (scale || freeOpen) return
    handleCode(code).catch((e: unknown) => setMessage({ tone: 'error', text: toAppError(e).message }))
  })

  async function onEnter() {
    if (searchText === '') {
      if (lines.length > 0 && text.trim() === '') setPaying(true)
      return
    }
    try {
      if (isCode) {
        await handleCode(normalizeBarcode(searchText))
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
            <div className={styles.cartActions}>
              <Button
                size="sm"
                disabled={!manualEnabled}
                title={manualEnabled ? undefined : 'Todavía no está habilitado en la base.'}
                onClick={() => setScale({ label: null, repeated: false })}
              >
                Producto de balanza
              </Button>
              <Button
                size="sm"
                disabled={!manualEnabled}
                title={manualEnabled ? undefined : 'Todavía no está habilitado en la base.'}
                onClick={() => setFreeOpen(true)}
              >
                Producto sin cargar
              </Button>
            </div>
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
                    Descuento
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
                {cart.lines.map((l) => {
                  const name = lineName(l)
                  return (
                    <tr key={l.key}>
                      <td>
                        {name}
                        {l.kind === 'product' && <span className={styles.muted}> · SKU {l.product.sku}</span>}
                        {l.kind === 'manual' && <span className={styles.lineTag}>Importe de etiqueta · SKU {l.product.sku}</span>}
                        {l.kind === 'free' && (
                          <span className={styles.lineTag}>Sin cargar · IVA {formatNumber(l.vatRate)} %</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {l.kind === 'product' ? (
                          <QuantityInput
                            label={`Cantidad de ${name}`}
                            value={l.quantity}
                            integer={isIntegerUnit(l.product.sale_unit)}
                            unit={SALE_UNIT_LABEL[l.product.sale_unit].toLowerCase()}
                            onChange={(quantity) => dispatch({ type: 'set', key: l.key, quantity })}
                          />
                        ) : (
                          `${formatNumber(l.quantity)}${l.kind === 'manual' ? ' kg' : ''}`
                        )}
                      </td>
                      <td className={styles.num}>
                        {l.kind === 'product' ? formatMoney(l.product.sale_price_with_vat) : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.num}>
                        {l.kind === 'product' ? (
                          <DiscountInput
                            label={`Descuento de ${name}`}
                            applied={l.appliedPercent}
                            suggested={l.suggestedPercent}
                            isCustom={l.discountPercent !== null}
                            rule={discountRule}
                            onChange={(percent) => dispatch({ type: 'discount', key: l.key, percent })}
                            onError={(text) => setMessage({ tone: 'error', text: `${name}: ${text}` })}
                          />
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {l.discountAmount > 0 && <s className={styles.muted}>{formatMoney(l.listTotal)}</s>}{' '}
                        <strong>{formatMoney(l.total)}</strong>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Quitar ${name}`}
                          onClick={() => {
                            dispatch({ type: 'remove', key: l.key })
                            focusScan()
                          }}
                        >
                          <Icon name="close" size={16} />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside className={`${styles.card} ${styles.totals}`} aria-label="Total">
          <p className={styles.totalLabel}>Total</p>
          <p className={styles.total} aria-live="polite">
            {formatMoney(total)}
          </p>
          {cart.discountTotal > 0 && (
            <p className={styles.discountTotal}>Descuentos: −{formatMoney(cart.discountTotal)}</p>
          )}
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
          cart={cart}
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

      {scale && (
        <ScaleItemDialog
          label={scale.label}
          repeated={scale.repeated}
          onCancel={() => {
            setScale(null)
            focusScan()
          }}
          onAdd={(item) => {
            const problem = mixError(lines, item.product.id, 'manual')
            if (problem) {
              setMessage({ tone: 'error', text: problem })
            } else {
              dispatch({ type: 'addManual', ...item })
              setMessage(null)
            }
            setScale(null)
            focusScan()
          }}
        />
      )}

      {freeOpen && (
        <FreeItemDialog
          onCancel={() => {
            setFreeOpen(false)
            focusScan()
          }}
          onAdd={(item) => {
            dispatch({ type: 'addFree', ...item })
            setFreeOpen(false)
            setMessage(null)
            focusScan()
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

function DiscountInput({
  label,
  applied,
  suggested,
  isCustom,
  rule,
  onChange,
  onError,
}: {
  label: string
  applied: number
  suggested: number
  isCustom: boolean
  rule: DiscountRule
  onChange: (percent: number | null) => void
  onError: (text: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(applied).replace('.', ',')
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    // Vacío: vuelve al sugerido.
    if (draft.trim() === '') return onChange(null)
    const n = parseDecimalInput(draft)
    const problem = n === null ? 'El descuento no es un número.' : discountError(n, rule)
    if (problem || n === null) return onError(problem ?? '')
    onChange(n === suggested ? null : n)
  }
  return (
    <span className={styles.discount}>
      <span className={styles.discountField}>
        <input
          className={`input ${styles.discountInput}`}
          inputMode="decimal"
          aria-label={`${label} (%)`}
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
        %
      </span>
      {isCustom ? (
        <button type="button" className={styles.discountReset} onClick={() => onChange(null)}>
          Sugerido: {String(suggested).replace('.', ',')} %
        </button>
      ) : (
        suggested > 0 && <span className={styles.muted}>Sugerido</span>
      )}
    </span>
  )
}
