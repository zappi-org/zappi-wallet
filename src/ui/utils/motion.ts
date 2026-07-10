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
