import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Eye, EyeOff } from 'lucide-react'
import { shouldStartReceiptTorn, type PaymentReceiptStatus } from './payment-receipt-motion'

export type { PaymentReceiptStatus } from './payment-receipt-motion'

const PAPER_HIDDEN_TRANSFORM = 'translate3d(0, -101%, 0)'
const PAPER_PRINTED_TRANSFORM = 'translate3d(0, -7%, 0)'
const PAPER_REST_TRANSFORM = 'translate3d(0, 0, 0)'
const PAPER_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'

/**
 * printing  — paper crawls out continuously, decelerating (fake progress);
 * finishing — result arrived: remaining paper feeds out fast, tears off the
 *             slot (top edge turns jagged, printer fades), stamp drops;
 * pending   — torn receipt, no stamp (settlement still confirming);
 * done      — torn receipt with the seal already on (complete screen).
 */
export interface PaymentReceiptRow {
  label: string
  value: string
  /** Rich value (e.g. mint icon + alias) — takes precedence over `value`. */
  valueNode?: ReactNode
  strong?: boolean
}

interface PaymentReceiptProps {
  status: PaymentReceiptStatus
  title: string
  /** Primary amount line, already formatted (₿1,000 / US$1.50). */
  amount: string
  fiat?: string | null
  rows: PaymentReceiptRow[]
  /** Centered status line (printing/pending): "전송 중" / "정산 확인 중". */
  statusLine?: string
  /** Done state's bottom line — the completion timestamp. Omit where a timeline
      on the paper already carries the times (the detail screens). */
  doneLine?: string
  /** Stamp image (the Zappi seal) — rendered on finishing (drops) and done (static). */
  stampSrc?: string
  /** Caption printed across the seal ("전송 완료") — rides the stamp's rotation. */
  stampLabel?: string
  onStampComplete?: () => void
  /** Optional QR node printed into the receipt body. The consumer supplies the
      rendered QR (e.g. <QRCodeDisplay/>) so the receipt stays free of the QR
      library's dependency chain; the receipt owns only the frame and veil. */
  qr?: ReactNode
  /** Veil the QR until tapped (bearer-token privacy); flow-owned state. */
  qrVeiled?: boolean
  onToggleQr?: () => void
  /** Reveal-hint label (i18n stays in the consumer; the receipt is presentational). */
  qrRevealLabel?: string
  /** Paper width in px — flows and the archive share one sheet size. */
  width?: number
  /** Printed between the amount block and the rows (the state timeline). */
  timeline?: ReactNode
  /** Extra content printed after the rows, above the bottom rule (e.g. details). */
  extra?: ReactNode
  /** Stamp anchor classes — the top corner keeps the seal off the text everywhere. */
  stampClass?: string
}

export function PaymentReceipt({
  status,
  title,
  amount,
  fiat,
  rows,
  statusLine,
  doneLine,
  stampSrc,
  stampLabel,
  onStampComplete,
  qr,
  qrVeiled,
  onToggleQr,
  qrRevealLabel,
  width = 330,
  timeline,
  extra,
  stampClass = 'top-12 right-3',
}: PaymentReceiptProps) {
  const reduceMotion = useReducedMotion()
  const teethId = useId()
  const teethTopId = useId()
  const supportsPaperAnimation = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'

  // Tear phase: complete-screen states start torn; finishing tears after the
  // fast feed-out animation resolves below.
  const startsTorn = shouldStartReceiptTorn(status, supportsPaperAnimation)
  const [torn, setTorn] = useState(startsTorn)
  // Render-phase adjustment (codebase pattern — see MemoSheet): torn is forced
  // for complete-screen states and reduced motion without an effect cascade.
  if ((startsTorn || reduceMotion) && !torn) setTorn(true)
  // Reserve the printer-slot height for the whole life of a receipt that
  // emerged from a slot, so finishing→done doesn't drop 14px and shift the
  // my-auto-centered receipt. Captured at mount: a standalone done/pending
  // receipt never had a slot and stays flush.
  const [hadSlot] = useState(!startsTorn)
  const paperRef = useRef<HTMLDivElement>(null)
  const paperAnimationRef = useRef<Animation | null>(null)
  const paperAnimationRunRef = useRef(0)

  const printing = status === 'printing' && !reduceMotion
  const feeding = status === 'finishing' && !torn && !reduceMotion
  const showSlot = (status === 'printing' || status === 'finishing') && !torn
  const showStamp = stampSrc && (status === 'done' || (status === 'finishing' && torn))
  const dotsAlive = (status === 'printing' || status === 'finishing') && !reduceMotion
  // The tear jolt is a one-shot shake, not a resting pose: it fires once the
  // finishing feed tears off, then settles straight. 'finishing' can linger
  // (awaiting claim, receive arrival), so a fixed -1.4° would sit crooked.
  const joltActive = torn && status === 'finishing' && !reduceMotion

  useLayoutEffect(() => {
    const paper = paperRef.current
    if (!paper) return

    const run = ++paperAnimationRunRef.current
    const currentTransform = feeding ? getComputedStyle(paper).transform : ''
    paperAnimationRef.current?.cancel()
    paperAnimationRef.current = null

    if (reduceMotion || (!printing && !feeding)) {
      paper.style.transform = PAPER_REST_TRANSFORM
      paper.style.willChange = ''
      return
    }

    const from = printing
      ? PAPER_HIDDEN_TRANSFORM
      : currentTransform && currentTransform !== 'none'
        ? currentTransform
        : PAPER_REST_TRANSFORM
    const to = printing ? PAPER_PRINTED_TRANSFORM : PAPER_REST_TRANSFORM
    const duration = printing ? 8000 : 320

    if (typeof paper.animate !== 'function') {
      paper.style.transform = to
      paper.style.willChange = ''
      if (feeding) {
        void Promise.resolve().then(() => {
          if (paperAnimationRunRef.current === run) setTorn(true)
        })
      }
      return
    }

    paper.style.willChange = 'transform'
    const animation = paper.animate(
      [{ transform: from }, { transform: to }],
      { duration, easing: PAPER_EASING, fill: 'forwards' },
    )
    paperAnimationRef.current = animation

    void animation.finished.then(() => {
      if (paperAnimationRunRef.current !== run) return
      paper.style.transform = to
      paper.style.willChange = ''
      animation.cancel()
      if (paperAnimationRef.current === animation) paperAnimationRef.current = null
      if (feeding) setTorn(true)
    }).catch(() => {})
  }, [feeding, printing, reduceMotion])

  useLayoutEffect(() => () => {
    paperAnimationRunRef.current += 1
    paperAnimationRef.current?.cancel()
    paperAnimationRef.current = null
  }, [])

  return (
    <div className="flex w-full flex-col items-center">
      {/* Printer slot — flat: a bar with an inset slit. Fades away at the tear
          so the complete state reads as a receipt in hand, not in a machine. */}
      {showSlot ? (
        <div className="relative z-20 h-3.5 rounded-full bg-background-hover" style={{ width: width + 20 }}>
          <div className="absolute inset-x-2.5 top-[5px] h-1 rounded-full bg-foreground/25" />
        </div>
      ) : (
        hadSlot && <div data-testid="receipt-slot" className="h-3.5" style={{ width: width + 20 }} aria-hidden />
      )}

      {/* Window clips the paper while it slides out of the slot */}
      <div className={`relative ${torn ? '' : '-mt-0.5 overflow-hidden'}`} style={{ width }}>
        {/* Tear jolt: the freed paper drops a touch and tilts askew, then
            settles straight back to rest — always ending at y 0, rotate 0, so
            the resting receipt sits at the same spot before and after the stamp
            (a y-10 rest would leave it shifted, then snap up on 'done'). */}
        <motion.div
          animate={
            joltActive
              ? { y: [0, 10, 0], rotate: [0, -1.4, 0] }
              : { y: 0, rotate: 0 }
          }
          transition={
            joltActive
              ? { duration: 0.55, times: [0, 0.5, 1], ease: [0.16, 1, 0.3, 1] }
              : { duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }
          }
        >
          <div ref={paperRef} data-testid="receipt-paper">
            {/* Torn top edge — appears the moment the paper leaves the roll */}
            {torn && (
              <svg className="block" width={width} height="8" viewBox={`0 0 ${width} 8`} aria-hidden>
                <defs>
                  <pattern id={teethTopId} width="12" height="8" patternUnits="userSpaceOnUse">
                    <path d="M0 8 L6 0 L12 8 Z" fill="var(--background-card)" />
                  </pattern>
                </defs>
                <rect width={width} height="8" fill={`url(#${teethTopId})`} />
              </svg>
            )}

            {/* Gutters and leading are deliberately generous: a receipt is read
                at a glance, and the printed blocks need air between them more
                than the sheet needs to be short. */}
            <div className="relative rounded-b-[2px] bg-background-card px-5 pb-3 pt-6 shadow-paper">
              <div className="text-center text-overline font-bold tracking-[0.14em] text-foreground-subtle">ZAPPI</div>
              <div className="mt-2 text-center text-subtitle font-semibold">{title}</div>
              <div className="mb-1 mt-4 text-center text-[30px] font-bold font-display leading-none tracking-tight">{amount}</div>
              {fiat && <div className="text-center text-label text-foreground-muted">{fiat}</div>}

              {timeline && (
                <>
                  <div className="mt-5 border-t-[1.5px] border-dashed border-border" />
                  <div className="pt-4">{timeline}</div>
                </>
              )}
              <div className={`mb-2 ${timeline ? 'mt-3.5' : 'mt-5'} border-t-[1.5px] border-dashed border-border`} />
              {rows.map((row, i) => (
                <div key={`${row.label}-${i}`} className="flex items-center justify-between gap-4 py-2 text-caption">
                  <span className="shrink-0 text-foreground-muted">{row.label}</span>
                  <span className={`truncate ${row.strong ? 'font-semibold' : 'font-medium'}`}>{row.valueNode ?? row.value}</span>
                </div>
              ))}
              {qr && (
                <button
                  type="button"
                  onClick={onToggleQr}
                  aria-label={qrRevealLabel}
                  // Full content width of the paper (width - px-[18px] gutters),
                  // so the QR grows with the sheet instead of a magic 264px.
                  // p-1 is a rim only — the QR owns its own quiet zone.
                  className="relative mx-auto mb-2 mt-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white p-1"
                >
                  <div className={`flex h-full w-full items-center justify-center transition-all ${qrVeiled ? 'blur-md opacity-40' : ''}`}>
                    {qr}
                  </div>
                  {qrVeiled && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                      <EyeOff className="h-6 w-6 text-foreground-muted" aria-hidden />
                      {qrRevealLabel && (
                        <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                          <Eye className="h-3 w-3" strokeWidth={1.8} />
                          <span>{qrRevealLabel}</span>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              )}
              {extra && (
                <>
                  <div className="mt-2.5 border-t-[1.5px] border-dashed border-border" />
                  <div className="pb-1.5 pt-3.5">{extra}</div>
                </>
              )}
              {/* One centered caption for every state — the completion label
                  itself now rides the stamp, so nothing sits on the right. A
                  paper with neither line ends after `extra` (the detail
                  screens, where the timeline carries the times). */}
              {(doneLine || statusLine) && (
                <>
                  <div className="mb-1.5 mt-2.5 border-t-[1.5px] border-dashed border-border" />
                  <div className="py-2.5 text-center text-caption text-foreground-muted">
                    {doneLine ?? statusLine}
                    {(status === 'printing' || status === 'finishing') && (
                      <span aria-hidden>
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className={dotsAlive ? 'receipt-status-dot--active' : undefined}
                            style={dotsAlive ? { animationDelay: `${i * 200}ms` } : undefined}
                          >
                            .
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* Zappi seal — the completion peak. Drops during finishing;
                  already resting on the paper on the complete screen. */}
              {showStamp && (
                <motion.div
                  className={`pointer-events-none absolute h-[84px] w-[84px] ${stampClass}`}
                  initial={
                    status === 'done' || reduceMotion
                      ? { opacity: 0, scale: 1, rotate: -12 }
                      : { opacity: 0, scale: 1.8, rotate: -24 }
                  }
                  animate={{ opacity: 0.92, scale: 1, rotate: -12 }}
                  transition={
                    status === 'done' || reduceMotion
                      ? { duration: 0.15 }
                      : { duration: 0.28, delay: 0.12, ease: [0.16, 1, 0.3, 1] }
                  }
                  onAnimationComplete={onStampComplete}
                >
                  <span className="absolute inset-0 rounded-full border-[2.5px] border-brand opacity-85" />
                  <span className="absolute inset-1 rounded-full border border-brand opacity-50" />
                  <img src={stampSrc} alt="" className="absolute inset-3 h-[60px] w-[60px] object-contain" />
                  {/* Ink band across the seal — the mascot is solid brand, so
                      the caption needs paper under it to stay readable. Long
                      locales (id/es) wrap to a second line instead of clipping. */}
                  {stampLabel && (
                    <span className="absolute inset-x-0 bottom-[13px] break-keep border-y border-brand/60 bg-background-card px-0.5 py-[3px] text-center text-[9px] font-bold leading-[1.15] text-brand">
                      {stampLabel}
                    </span>
                  )}
                </motion.div>
              )}
            </div>

            {/* Perforated tear-off edge */}
            <svg className="block" width={width} height="8" viewBox={`0 0 ${width} 8`} aria-hidden>
              <defs>
                <pattern id={teethId} width="12" height="8" patternUnits="userSpaceOnUse">
                  <path d="M0 0 L6 8 L12 0 Z" fill="var(--background-card)" />
                </pattern>
              </defs>
              <rect width={width} height="8" fill={`url(#${teethId})`} />
            </svg>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
