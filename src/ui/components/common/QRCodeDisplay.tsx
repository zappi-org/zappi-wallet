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
 */

import { useState, useEffect, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { UR, UREncoder } from '@gandlaf21/bc-ur'
import { Buffer } from 'buffer'
import { cn } from '@/lib/utils'

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

export interface QRCodeDisplayProps {
  value: string
  size?: number
  className?: string
  /** QR error correction level for static QR. Ignored in animated mode. */
  level?: 'L' | 'M' | 'Q' | 'H'
}

export function QRCodeDisplay({
  value,
  size = 200,
  className,
  level = 'M',
}: QRCodeDisplayProps) {
  const isAnimated = value.length > ANIMATED_THRESHOLD

  if (isAnimated) {
    // key={value} forces remount on value change, resetting all state cleanly
    return (
      <AnimatedQR
        key={value}
        value={value}
        size={size}
        className={className}
      />
    )
  }

  return (
    <div className={cn('bg-background-card p-4 rounded-[13px] shadow-sm', className)}>
      <QRCodeSVG
        value={value}
        size={size}
        level={level}
        includeMargin={false}
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
  size,
  className,
}: {
  value: string
  size: number
  className?: string
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

  return (
    <div className={cn('bg-background-card p-4 rounded-[13px] shadow-sm relative', className)}>
      <QRCodeSVG
        value={frame.value}
        size={size}
        level="L"
        includeMargin={false}
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
