/**
 * QRCodeDisplay — Static or animated (UR) QR code display
 *
 * NUT-16 compliant: When value exceeds single QR capacity,
 * automatically switches to BC-UR fountain-coded animated QR.
 * Same approach as Cashu.me / Macadamia / Minibits.
 *
 * Uses continuous UREncoder.nextPart() to produce true fountain-coded
 * frames (Luby Transform). This means the scanner can start at any frame,
 * miss frames, and still decode — redundant frames fill in the gaps.
 *
 * Sizing: QR fills 65% of viewport width, capped at 360px on large screens.
 * The `size` prop controls SVG render resolution (default 400 for sharpness).
 */

import { memo, useState, useEffect, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { UR, UREncoder } from '@gandlaf21/bc-ur'
import { Buffer } from 'buffer'
import { cn } from '@/ui/lib/utils'

/**
 * Threshold (in characters) above which we switch to animated UR QR.
 * QR version 27 (125×125) holds ~1062 bytes in alphanumeric mode.
 * We use a conservative 500 chars to ensure clean, easily-scannable QR codes.
 */
const ANIMATED_THRESHOLD = 500

/** Max fragment length for UR encoder (bytes per frame, matches Cashu.me/Minibits) */
const MAX_FRAGMENT_LENGTH = 150

/** Frame interval in ms (~4 fps, matches Cashu.me behavior) */
const FRAME_INTERVAL_MS = 250

/** SVG render resolution — large enough for sharp scaling */
const RENDER_SIZE = 400

/** Max display width on large screens */
const MAX_DISPLAY_WIDTH = 360

export interface QRCodeDisplayProps {
  value: string
  size?: number
  className?: string
  /** QR error correction level for static QR. Ignored in animated mode. */
  level?: 'L' | 'M' | 'Q' | 'H'
  /**
   * When true, the QR fills its parent container (100% width) without the
   * component's own card styling or 65vw/360px max-width constraint.
   * Use this when the caller already provides the outer frame.
   */
  fill?: boolean
}

// Memoized: QR matrix generation is the priciest render in these screens, and
// parents re-render for reasons (countdowns, copy state) that don't change props.
export const QRCodeDisplay = memo(function QRCodeDisplay({
  value,
  size,
  className,
  level = 'M',
  fill = false,
}: QRCodeDisplayProps) {
  // bitcoin: URIs must stay single-frame — generic wallets can't read BC-UR.
  // Hard cap 2500: beyond that a static QR stops scanning at phone size, so we
  // fall back to UR and log — silent interop loss is worse than a console line.
  const isUri = value.startsWith('bitcoin:')
  const overCap = value.length > 2500
  if (isUri && overCap) console.warn('[QR] bitcoin: URI exceeds static cap, falling back to UR')
  const isAnimated = value.length > ANIMATED_THRESHOLD && (!isUri || overCap)
  const renderSize = size ?? RENDER_SIZE

  if (isAnimated) {
    // key={value} forces remount on value change, resetting all state cleanly
    return (
      <AnimatedQR
        key={value}
        value={value}
        renderSize={renderSize}
        className={className}
        fill={fill}
      />
    )
  }

  const wrapperClass = fill
    ? cn('w-full h-full flex items-center justify-center', className)
    : cn('bg-background-card p-4 rounded-xl shadow-sm', className)
  const wrapperStyle = fill ? undefined : { width: '65vw', maxWidth: MAX_DISPLAY_WIDTH }

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      <QRCodeSVG
        value={value}
        size={renderSize}
        level={isUri ? 'L' : level}
        marginSize={4}
        style={{ width: '100%', height: 'auto' }}
      />
    </div>
  )
})

/**
 * Animated UR QR — true fountain-coded multipart frames.
 *
 * Parent renders with key={value}, so value is stable for this component's
 * entire lifetime. This lets us:
 *   1. Create the encoder once in useMemo (first frame via nextPart())
 *   2. Continue calling nextPart() in setInterval — producing fountain-coded
 *      redundant frames beyond the base set, exactly like Cashu.me/Macadamia
 *   3. No synchronous setState in effect body, no ref access during render
 */
function AnimatedQR({
  value,
  renderSize,
  className,
  fill = false,
}: {
  value: string
  renderSize: number
  className?: string
  fill?: boolean
}) {
  // Create encoder and consume first frame synchronously (safe — runs once per mount)
  const { encoder, totalFragments, firstFrame } = useMemo(() => {
    const buf = Buffer.from(value, 'utf-8')
    const ur = UR.fromBuffer(buf)
    const enc = new UREncoder(ur, MAX_FRAGMENT_LENGTH)
    return {
      encoder: enc,
      totalFragments: enc.fragmentsLength,
      firstFrame: enc.nextPart(),
    }
  }, [value])

  const [frame, setFrame] = useState({ value: firstFrame, index: 0 })

  // Continuously generate fountain-coded frames via nextPart()
  // After base fragments are exhausted, nextPart() produces redundant
  // fountain frames that help the scanner recover missed data.
  //
  // Paused while the document is hidden: nobody can scan a background tab,
  // so ticking there only burns CPU/battery. Deliberately NOT gated on
  // prefers-reduced-motion — the frame cycling is the data channel, and a
  // frozen frame would make the payload unscannable.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (interval !== null) return
      interval = setInterval(() => {
        setFrame((prev) => ({
          value: encoder.nextPart(),
          index: prev.index + 1,
        }))
      }, FRAME_INTERVAL_MS)
    }
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    }
    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }
    handleVisibility()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      stop()
    }
  }, [encoder])

  const displayFrame = (frame.index % totalFragments) + 1

  const wrapperClass = fill
    ? cn('w-full h-full flex items-center justify-center', className)
    : cn('bg-background-card p-4 rounded-xl shadow-sm flex flex-col items-center', className)
  const wrapperStyle = fill ? undefined : { width: '65vw', maxWidth: MAX_DISPLAY_WIDTH }

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      <QRCodeSVG
        value={frame.value}
        size={renderSize}
        level="L"
        marginSize={4}
        style={{ width: '100%', height: 'auto' }}
      />
      {/* Normal-flow counter (not absolute) so it never overlaps QR modules.
          Skipped in fill mode: PaymentReceipt's aspect-square, overflow-hidden
          frame would clip an in-flow sibling there. */}
      {!fill && (
        <span className="mt-1 text-[10px] text-foreground-muted/60 tabular-nums">
          {displayFrame} / {totalFragments}
        </span>
      )}
    </div>
  )
}
