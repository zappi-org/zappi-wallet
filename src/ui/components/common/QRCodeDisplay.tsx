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

import { useState, useEffect, useMemo } from 'react'
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

export function QRCodeDisplay({
  value,
  size,
  className,
  level = 'M',
  fill = false,
}: QRCodeDisplayProps) {
  const isAnimated = value.length > ANIMATED_THRESHOLD
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
        level={level}
        includeMargin={false}
        style={{ width: '100%', height: 'auto' }}
      />
    </div>
  )
}

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
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => ({
        value: encoder.nextPart(),
        index: prev.index + 1,
      }))
    }, FRAME_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [encoder])

  const displayFrame = (frame.index % totalFragments) + 1

  const wrapperClass = fill
    ? cn('w-full h-full flex items-center justify-center relative', className)
    : cn('bg-background-card p-4 rounded-xl shadow-sm relative', className)
  const wrapperStyle = fill ? undefined : { width: '65vw', maxWidth: MAX_DISPLAY_WIDTH }

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      <QRCodeSVG
        value={frame.value}
        size={renderSize}
        level="L"
        includeMargin={false}
        style={{ width: '100%', height: 'auto' }}
      />
      {/* Frame indicator */}
      <div className="absolute bottom-1.5 left-0 right-0 flex justify-center">
        <span className="text-[10px] text-foreground-muted/60 tabular-nums">
          {displayFrame} / {totalFragments}
        </span>
      </div>
    </div>
  )
}
