import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

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

  const printing = status === 'printing' && !reduceMotion
  const feeding = status === 'finishing' && !torn && !reduceMotion
  const showSlot = (status === 'printing' || status === 'finishing') && !torn
  const showStamp = stampSrc && (status === 'done' || (status === 'finishing' && torn))
  const dotsAlive = (status === 'printing' || status === 'finishing') && !reduceMotion

  return (
    <div className="flex w-full flex-col items-center">
      {/* Printer slot — flat: a bar with an inset slit. Fades away at the tear
          so the complete state reads as a receipt in hand, not in a machine. */}
      {showSlot ? (
        <div className="relative z-20 h-3.5 w-[280px] rounded-full bg-background-hover">
          <div className="absolute inset-x-2.5 top-[5px] h-1 rounded-full bg-foreground/25" />
        </div>
      ) : (
        status === 'finishing' && <div className="h-3.5 w-[280px]" aria-hidden />
      )}

      {/* Window clips the paper while it slides out of the slot */}
      <div className={`relative w-[250px] ${torn ? '' : '-mt-0.5 overflow-hidden'}`}>
        {/* Tear jolt: the freed paper drops a touch and settles slightly askew */}
        <motion.div
          animate={
            torn && status === 'finishing'
              ? { y: 10, rotate: -1.4 }
              : { y: 0, rotate: 0 }
          }
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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
              <svg className="block" width="250" height="8" viewBox="0 0 250 8" aria-hidden>
                <defs>
                  <pattern id={teethTopId} width="12" height="8" patternUnits="userSpaceOnUse">
                    <path d="M0 8 L6 0 L12 8 Z" fill="var(--background-card)" />
                  </pattern>
                </defs>
                <rect width="250" height="8" fill={`url(#${teethTopId})`} />
              </svg>
            )}

            <div className="relative rounded-b-[2px] bg-background-card px-[18px] pb-2 pt-[18px] shadow-[0_8px_24px_rgba(29,29,31,0.08)]">
              <div className="text-center text-[11px] font-bold tracking-[0.14em] text-foreground-subtle">ZAPPI</div>
              <div className="mt-1.5 text-center text-subtitle font-semibold">{title}</div>
              <div className="mb-0.5 mt-3 text-center text-[30px] font-bold leading-none tracking-tight">{amount}</div>
              {fiat && <div className="text-center text-label text-foreground-muted">{fiat}</div>}

              <div className="mb-1.5 mt-3.5 border-t-[1.5px] border-dashed border-border" />
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-[5px] text-caption">
                  <span className="shrink-0 text-foreground-muted">{row.label}</span>
                  <span className={`truncate ${row.strong ? 'font-semibold' : 'font-medium'}`}>{row.value}</span>
                </div>
              ))}
              <div className="mb-1 mt-1.5 border-t-[1.5px] border-dashed border-border" />

              {doneLine ? (
                <div className="flex items-center justify-between py-2 text-caption">
                  <span className="text-foreground-muted">{doneLine.left}</span>
                  <span className="font-semibold text-brand">{doneLine.right}</span>
                </div>
              ) : (
                <div className="py-2.5 text-center text-caption text-foreground-muted">
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
                  className="pointer-events-none absolute bottom-14 right-5 h-[84px] w-[84px]"
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
            <svg className="block" width="250" height="8" viewBox="0 0 250 8" aria-hidden>
              <defs>
                <pattern id={teethId} width="12" height="8" patternUnits="userSpaceOnUse">
                  <path d="M0 0 L6 8 L12 0 Z" fill="var(--background-card)" />
                </pattern>
              </defs>
              <rect width="250" height="8" fill={`url(#${teethId})`} />
            </svg>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
