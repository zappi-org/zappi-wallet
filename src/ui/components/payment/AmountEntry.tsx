/**
 * AmountEntry — the shared amount surface (Cash App style: oversized hero, the
 * keypad melting into the background). Owns fiat toggling internally; the parent
 * holds only the raw sat-digit string. New here vs the old send hero: per-glyph
 * digit-roll, a keypress scale pulse, and a ₿↔fiat rotateX flip — all
 * reduced-motion aware.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, useAnimationControls, useReducedMotion } from 'motion/react'
import { ArrowUpDown } from 'lucide-react'
import { NumericKeypad } from '@/ui/components/common/NumericKeypad'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import {
  appendFiatInput,
  formatFiatInputForDisplay,
  getFiatDecimalSeparator,
  getFiatFractionDigits,
  useFormatFiat,
  useFormatSats,
  useSatUnit,
} from '@/utils/format'
import { hapticTap } from '@/ui/utils/haptic'

export interface AmountEntryFiatState {
  isFiatMode: boolean
  fiatAmount: string
}

export interface AmountEntryProps {
  /** Canonical raw sat digits; the parent owns this string. */
  value: string
  /** Next raw sat digits after each edit (fiat input is converted to sats first). */
  onChange: (next: string) => void
  /** Seeds the internal fiat toggle (restores mode on back-navigation). */
  initialFiatMode?: boolean
  initialFiatAmount?: string
  /** Fires on fiat state change so a parent draft can persist it; callback identity may be unstable (held in a ref internally, never a render trigger). */
  onFiatStateChange?: (state: AmountEntryFiatState) => void
  /** Over-balance / invalid → x-axis shake + danger color. */
  insufficientBalance?: boolean
  /** Disable all input (amount fixed by an invoice); keypad dims. */
  disabled?: boolean
  /** Shown centered when the amount is empty (e.g. "How much to send?"). */
  emptyPrompt?: string
  /** Above the hero — recipient eyebrow, mint bar, etc. */
  topSlot?: ReactNode
  /** Inside the hero, right under the conversion line — e.g. a balance caption. */
  heroSlot?: ReactNode
  /** Between the conversion line and the keypad — e.g. the receive memo trigger. */
  middleSlot?: ReactNode
  /** Below the keypad — CTA / reset row. */
  bottomSlot?: ReactNode
}

// Font auto-scale by displayed glyph count (Cash App shrinks as it grows).
function heroSizeClass(len: number): string {
  if (len <= 6) return 'text-[44px]'
  if (len <= 9) return 'text-[36px]'
  return 'text-[30px]'
}

interface HeroGlyph {
  ch: string
  key: string
  /** Place value counted from the ones digit; undefined for decoration glyphs. */
  pos?: number
}

// Digits are keyed by place value (0 = ones) so formatter-inserted grouping
// separators never reshuffle existing keys: typing mounts only the new
// most-significant digit and delete exits only the highest. Index-based keys
// would reflow every glyph past the 3-digit comma boundary. Separators,
// currency symbols, and unit suffixes are decoration keyed off the neighboring
// place (plus a run offset for multi-char suffixes like " sat").
function buildGlyphs(display: string): HeroGlyph[] {
  const glyphs: HeroGlyph[] = []
  let pos = 0
  let run = 0
  for (let i = display.length - 1; i >= 0; i -= 1) {
    const ch = display[i]
    if (ch >= '0' && ch <= '9') {
      glyphs.push({ ch, key: `d-${pos}`, pos })
      pos += 1
      run = 0
    } else {
      glyphs.push({ ch, key: `sep-${pos}-${run}` })
      run += 1
    }
  }
  return glyphs.reverse()
}

export function AmountEntry({
  value,
  onChange,
  initialFiatMode = false,
  initialFiatAmount = '',
  onFiatStateChange,
  insufficientBalance = false,
  disabled = false,
  emptyPrompt,
  topSlot,
  heroSlot,
  middleSlot,
  bottomSlot,
}: AmountEntryProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const formatSats = useFormatSats()
  const unit = useSatUnit()
  const toFiat = useFormatFiat()

  const {
    isFiatMode,
    fiatInput,
    fiatCurrency,
    currencySymbol,
    exchangeRate,
    showFiat,
    handleToggleFiat,
    handleFiatChange,
  } = useFiatToggle(value, onChange, { initialFiatMode, initialFiatAmount })

  const canToggleFiat = exchangeRate !== null && showFiat && !disabled
  const fiatFractionDigits = getFiatFractionDigits(fiatCurrency)
  const numericAmount = parseInt(value, 10) || 0
  const isEmpty = isFiatMode ? fiatInput.length === 0 : numericAmount === 0

  // Keep the latest callback in a ref (no-deps effect runs after every render)
  // so the state-sync effect below never has to depend on caller identity —
  // an inline arrow or unmemoized setter would otherwise re-fire on every render.
  const onFiatStateChangeRef = useRef(onFiatStateChange)
  useEffect(() => {
    onFiatStateChangeRef.current = onFiatStateChange
  })

  // Fire on fiat state change; the callback itself is read from the ref above,
  // so its identity may be unstable without causing extra invocations.
  useEffect(() => {
    onFiatStateChangeRef.current?.({ isFiatMode, fiatAmount: fiatInput })
  }, [isFiatMode, fiatInput])

  // Keypress scale pulse — a key counter drives a spring without remounting the
  // hero (a remount would kill the digit-roll AnimatePresence beneath it).
  const [pulse, setPulse] = useState(0)
  const pulseControls = useAnimationControls()
  useEffect(() => {
    if (pulse === 0 || reduceMotion) return
    void pulseControls.start({ scale: [1, 1.02, 1], transition: { type: 'spring', stiffness: 500, damping: 18 } })
  }, [pulse, pulseControls, reduceMotion])

  const handleKey = useCallback((key: string) => {
    if (disabled) return
    // Haptic + pulse only when the keystroke actually mutates the value —
    // rejected input (length cap, full fraction, empty delete) stays silent.
    const commit = (apply: () => void) => {
      hapticTap()
      setPulse((n) => n + 1)
      apply()
    }
    if (key === 'delete') {
      if (isFiatMode) {
        if (fiatInput.length === 0) return
        commit(() => handleFiatChange(fiatInput.slice(0, -1)))
      } else {
        if (value.length === 0) return
        commit(() => onChange(value.slice(0, -1)))
      }
      return
    }
    if (isFiatMode) {
      const next = appendFiatInput(fiatInput, key, fiatFractionDigits)
      if (next === fiatInput) return
      commit(() => handleFiatChange(next))
      return
    }
    if (!/^[0-9]$/.test(key)) return
    const next = (value + key).replace(/^0+(?=\d)/, '')
    if (next.length > 12 || next === value) return
    commit(() => onChange(next))
  }, [disabled, isFiatMode, fiatInput, value, handleFiatChange, onChange, fiatFractionDigits])

  const displayAmount = isFiatMode
    ? `${currencySymbol}${fiatInput ? formatFiatInputForDisplay(fiatInput) : '0'}`
    : formatSats(numericAmount)

  const secondary = isFiatMode ? formatSats(numericAmount) : toFiat(numericAmount) ?? `${currencySymbol}0`

  const glyphs = useMemo(() => buildGlyphs(displayAmount), [displayAmount])

  return (
    <div className="flex h-full flex-col">
      {topSlot}

      {/* Hero — flex-1 so the keypad pins to the bottom while the amount grows. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6">
        <motion.div
          animate={insufficientBalance && !reduceMotion ? { x: [0, -8, 8, -6, 6, 0] } : { x: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <motion.div animate={pulseControls} className="flex items-center justify-center" style={{ perspective: 600 }}>
            {isEmpty && emptyPrompt ? (
              <span className="break-keep text-center text-[26px] font-bold leading-snug text-foreground">
                {emptyPrompt}
              </span>
            ) : (
              <>
                {/* Per-glyph spans fragment the DOM text into single-char nodes, so
                    neither assistive tech nor plain-text queries see one string —
                    mirror it here as the one accessible source of truth. */}
                <span className="sr-only">{displayAmount}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={isFiatMode ? 'fiat' : 'sats'}
                    aria-hidden="true"
                    initial={reduceMotion ? false : { rotateX: 90, opacity: 0 }}
                    animate={{ rotateX: 0, opacity: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { rotateX: -90, opacity: 0 }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className={`inline-flex overflow-hidden font-light leading-none tracking-tight ${heroSizeClass(displayAmount.length)} ${
                      insufficientBalance ? 'text-accent-danger' : 'text-foreground'
                    }`}
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      {glyphs.map(({ ch, key, pos }) =>
                        pos === undefined ? (
                          // Decoration never rolls — a comma that y-rolled during a
                          // grouping reflow would read as digits jumping around.
                          // whitespace-pre keeps the unit-suffix space from
                          // collapsing to zero width inside the flex hero.
                          <motion.span
                            key={key}
                            initial={false}
                            exit={{ opacity: 0, transition: { duration: 0 } }}
                            className="whitespace-pre"
                          >
                            {ch}
                          </motion.span>
                        ) : (
                          <motion.span
                            key={key}
                            data-pos={pos}
                            initial={reduceMotion ? false : { y: '0.6em', opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={reduceMotion ? { opacity: 0 } : { y: '-0.6em', opacity: 0 }}
                            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }}
                            className="inline-block tabular-nums"
                          >
                            {ch}
                          </motion.span>
                        ),
                      )}
                    </AnimatePresence>
                  </motion.span>
                </AnimatePresence>
              </>
            )}
          </motion.div>
        </motion.div>

        {!isEmpty && (showFiat || isFiatMode) && (
          <button
            type="button"
            onClick={canToggleFiat ? () => { hapticTap(); handleToggleFiat() } : undefined}
            disabled={!canToggleFiat}
            aria-label={t('send.tokenCreate.toggleUnit', { current: isFiatMode ? currencySymbol : unit })}
            className="flex items-center gap-1.5 text-body text-foreground-muted disabled:cursor-default"
          >
            <span>{secondary}</span>
            {canToggleFiat && <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={2.2} />}
          </button>
        )}

        {heroSlot}
      </div>

      {middleSlot}

      <div className={disabled ? 'pointer-events-none opacity-30' : ''}>
        <NumericKeypad
          onKeyPress={handleKey}
          decimalLabel={isFiatMode && fiatFractionDigits > 0 ? getFiatDecimalSeparator() : undefined}
        />
      </div>

      {bottomSlot}
    </div>
  )
}
