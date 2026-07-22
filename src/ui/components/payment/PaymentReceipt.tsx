import { useId, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Eye } from 'lucide-react'

/**
 * printing  — paper crawls out continuously, decelerating (fake progress);
 * finishing — result arrived: remaining paper feeds out fast, tears off the
 *             slot (top edge turns jagged, printer fades), stamp drops;
 * pending   — torn receipt, no stamp (settlement still confirming);
 * done      — torn receipt with the seal already on (complete screen).
 */
export type PaymentReceiptStatus = 'printing' | 'finishing' | 'pending' | 'done'

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
  /** Done state's bottom row: timestamp left, "전송 완료" right. */
  doneLine?: { left: string; right: string }
  /** Stamp image (the Zappi seal) — rendered on finishing (drops) and done (static). */
  stampSrc?: string
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
  /** Extra content printed after the rows, above the bottom rule (e.g. a state bar). */
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
  onStampComplete,
  qr,
  qrVeiled,
  onToggleQr,
  qrRevealLabel,
  width = 330,
  extra,
  stampClass = 'top-12 right-3',
}: PaymentReceiptProps) {
  const reduceMotion = useReducedMotion()
  const teethId = useId()
  const teethTopId = useId()

  // Tear phase: complete-screen states start torn; finishing tears after the
  // fast feed-out lands (onAnimationComplete below).
  const startsTorn = status === 'done' || status === 'pending'
  const [torn, setTorn] = useState(startsTorn)
  // Render-phase adjustment (codebase pattern — see MemoSheet): torn is forced
  // for complete-screen states and reduced motion without an effect cascade.
  if ((startsTorn || reduceMotion) && !torn) setTorn(true)
  // Reserve the printer-slot height for the whole life of a receipt that
  // emerged from a slot, so finishing→done doesn't drop 14px and shift the
  // my-auto-centered receipt. Captured at mount: a standalone done/pending
  // receipt never had a slot and stays flush.
  const [hadSlot] = useState(!startsTorn)

  const printing = status === 'printing' && !reduceMotion
  const feeding = status === 'finishing' && !torn && !reduceMotion
  const showSlot = (status === 'printing' || status === 'finishing') && !torn
  const showStamp = stampSrc && (status === 'done' || (status === 'finishing' && torn))
  const dotsAlive = (status === 'printing' || status === 'finishing') && !reduceMotion
  // The tear jolt is a one-shot shake, not a resting pose: it fires once the
  // finishing feed tears off, then settles straight. 'finishing' can linger
  // (awaiting claim, receive arrival), so a fixed -1.4° would sit crooked.
  const joltActive = torn && status === 'finishing' && !reduceMotion

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
          <motion.div
            initial={printing ? { y: '-101%' } : { y: 0 }}
            animate={
              printing
                ? // One continuous emergence that decelerates into a crawl —
                  // the asymptotic fake-progress; finishing snaps it to 0.
                  { y: ['-101%', '-16%', '-7%'] }
                : { y: 0 }
            }
            transition={
              printing
                ? { duration: 8, times: [0, 0.34, 1], ease: ['easeOut', 'linear'] }
                : feeding
                  ? { duration: 0.32, ease: [0.16, 1, 0.3, 1] }
                  : { duration: 0 }
            }
            onAnimationComplete={() => {
              if (status === 'finishing' && !torn) setTorn(true)
            }}
          >
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

            <div className="relative rounded-b-[2px] bg-background-card px-[18px] pb-2 pt-[18px] shadow-[0_8px_24px_rgba(29,29,31,0.08)]">
              <div className="text-center text-[11px] font-bold tracking-[0.14em] text-foreground-subtle">ZAPPI</div>
              <div className="mt-1.5 text-center text-subtitle font-semibold">{title}</div>
              <div className="mb-0.5 mt-3 text-center text-[30px] font-bold leading-none tracking-tight">{amount}</div>
              {fiat && <div className="text-center text-label text-foreground-muted">{fiat}</div>}

              <div className="mb-1.5 mt-3.5 border-t-[1.5px] border-dashed border-border" />
              {rows.map((row, i) => (
                <div key={`${row.label}-${i}`} className="flex items-center justify-between gap-3 py-[5px] text-caption">
                  <span className="shrink-0 text-foreground-muted">{row.label}</span>
                  <span className={`truncate ${row.strong ? 'font-semibold' : 'font-medium'}`}>{row.valueNode ?? row.value}</span>
                </div>
              ))}
              {qr && (
                <button
                  type="button"
                  onClick={onToggleQr}
                  aria-label={qrRevealLabel}
                  className="relative mx-auto mt-2 mb-1 flex aspect-square w-[200px] items-center justify-center overflow-hidden rounded-lg bg-white p-2"
                >
                  <div className={`flex h-full w-full items-center justify-center transition-all ${qrVeiled ? 'blur-md opacity-40' : ''}`}>
                    {qr}
                  </div>
                  {qrVeiled && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                      <div className="text-3xl" aria-hidden>🙈</div>
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
                  <div className="mt-1.5 border-t-[1.5px] border-dashed border-border" />
                  <div className="pt-2.5 pb-1">{extra}</div>
                </>
              )}
              <div className="mb-1 mt-1.5 border-t-[1.5px] border-dashed border-border" />

              {doneLine ? (
                <div className="flex items-center justify-between py-2 text-caption">
                  <span className="text-foreground-muted">{doneLine.left}</span>
                  <span className="font-semibold text-brand">{doneLine.right}</span>
                </div>
              ) : (
                <div className="py-2 text-center text-caption text-foreground-muted">
                  {statusLine}
                  {(status === 'printing' || status === 'finishing') && (
                    <span aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          animate={dotsAlive ? { opacity: [0, 1, 1, 0] } : { opacity: 1 }}
                          transition={
                            dotsAlive
                              ? { duration: 1.2, times: [0, 0.3, 0.8, 1], repeat: Infinity, delay: i * 0.2 }
                              : { duration: 0 }
                          }
                        >
                          .
                        </motion.span>
                      ))}
                    </span>
                  )}
                </div>
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
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
