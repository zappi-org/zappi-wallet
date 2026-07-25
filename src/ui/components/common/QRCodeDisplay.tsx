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
 * Sizing: the QR fills its container, so each screen owns the width; the cap
 * below only guards an unbounded (desktop) column. The spec's 4-module quiet
 * zone is drawn inside the SVG, which keeps it scale-invariant — a wrapper must
 * not add padding of its own, or the quiet zone doubles and every module shrinks.
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

/**
 * Intrinsic width/height attribute on the <svg>. The viewBox is in module
 * units, so this never affects sharpness — it is only the size the element
 * reports before CSS lays it out.
 */
const SVG_INTRINSIC_SIZE = 400

/** Cap for unbounded containers (desktop); every phone column is narrower. */
const MAX_DISPLAY_WIDTH = 360

/** Spec quiet zone in modules. Owned here, never by a wrapper's padding. */
const QUIET_ZONE_MODULES = 4

export interface QRCodeDisplayProps {
  value: string
  className?: string
  /** QR error correction level for static QR. Ignored in animated mode. */
  level?: 'L' | 'M' | 'Q' | 'H'
  /**
   * When true, the QR fills its parent container (100% width/height) without
   * the component's own card styling or max-width cap.
   * Use this when the caller already provides the outer frame.
   */
  fill?: boolean
}

/**
 * p-1 is a decorative rim so the rounded card still reads as a card; the
 * scannable margin is the SVG's own quiet zone. overflow-hidden lets the
 * radius clip the SVG's square white background.
 */
function frameProps(fill: boolean, className?: string) {
  return fill
    ? { className: cn('w-full h-full flex items-center justify-center', className), style: undefined }
    : {
        className: cn('w-full overflow-hidden bg-background-card p-1 rounded-xl shadow-sm', className),
        style: { maxWidth: MAX_DISPLAY_WIDTH },
      }
}

// Memoized: QR matrix generation is the priciest render in these screens, and
// parents re-render for reasons (countdowns, copy state) that don't change props.
export const QRCodeDisplay = memo(function QRCodeDisplay({
  value,
  className,
  level = 'M',
  fill = false,
}: QRCodeDisplayProps) {
  // A dense static QR at phone size may not scan at all, so long payloads —
  // bitcoin: URIs included — animate like any other protocol.
  const isAnimated = value.length > ANIMATED_THRESHOLD

  if (isAnimated) {
    // key={value} forces remount on value change, resetting all state cleanly
    return <AnimatedQR key={value} value={value} className={className} fill={fill} />
  }

  return (
    <div {...frameProps(fill, className)}>
      <QRCodeSVG
        value={value}
        size={SVG_INTRINSIC_SIZE}
        level={level}
        marginSize={QUIET_ZONE_MODULES}
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
  className,
  fill = false,
}: {
  value: string
  className?: string
  fill?: boolean
}) {
  // Create encoder and consume first frame synchronously (safe — runs once per mount)
  const { encoder, firstFrame } = useMemo(() => {
    const buf = Buffer.from(value, 'utf-8')
    const ur = UR.fromBuffer(buf)
    const enc = new UREncoder(ur, MAX_FRAGMENT_LENGTH)
    return { encoder: enc, firstFrame: enc.nextPart() }
  }, [value])

  const [frame, setFrame] = useState(firstFrame)

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
        setFrame(encoder.nextPart())
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

  return (
    <div {...frameProps(fill, className)}>
      <QRCodeSVG
        value={frame}
        size={SVG_INTRINSIC_SIZE}
        level="L"
        marginSize={QUIET_ZONE_MODULES}
        style={{ width: '100%', height: 'auto' }}
      />
    </div>
  )
}
