import type { Transition } from 'motion/react'

/** Uniform duration for prefers-reduced-motion fallback fades (opacity-only). */
export const REDUCED_MOTION_FADE_DURATION = 0.1

/**
 * easeOut duration transition that collapses to the uniform reduced-motion
 * fade when the user prefers reduced motion.
 */
export function fadeTransition(reduceMotion: boolean | null, duration: number): Transition {
  return { duration: reduceMotion ? REDUCED_MOTION_FADE_DURATION : duration, ease: 'easeOut' }
}

/**
 * Full-motion transition normally; the uniform reduced fade when the user
 * prefers reduced motion. For transitions whose full-motion shape isn't a
 * plain easeOut fade (custom cubics, springs, motion defaults).
 */
export function motionSafeTransition(reduceMotion: boolean | null, full?: Transition): Transition | undefined {
  return reduceMotion ? { duration: REDUCED_MOTION_FADE_DURATION, ease: 'easeOut' } : full
}

/**
 * The presentation curve every sheet shares, both directions: a quarter of the
 * way through the time it has covered 47% of the distance, half way 81%.
 */
export const SHEET_EASE = [0.18, 0.08, 0.24, 1] as const

const BASE_SETTLE_MS = 256
const MAX_SETTLE_MS = 600

/**
 * How long a sheet should take to cover `travel` px of a `viewport`-tall screen.
 *
 * One fixed duration gives every sheet the same time for a different distance,
 * so a short one crawls and a tall one bolts — two sheets on the same screen
 * read as two different speeds. Timing from the fraction of the screen crossed
 * keeps them close: 256ms for nothing, 512ms for the whole screen.
 */
export function sheetSettleMs(travel: number, viewport: number): number {
  if (travel <= 0 || viewport <= 0) return 0
  const crossed = Math.min(1, travel / viewport)
  return Math.min(MAX_SETTLE_MS, Math.round((crossed + 1) * BASE_SETTLE_MS))
}
