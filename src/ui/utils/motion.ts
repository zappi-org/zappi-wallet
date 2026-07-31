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
 * Fitted to Apple's system spring (Animation.smooth: duration 0.5, bounce 0):
 * at a quarter of the time it has covered 47% of the distance, at half 81%.
 * One curve both ways, as a spring is — Material's asymmetric emphasized pair
 * was tried here and read wrong against the rest of the app.
 */
export const SHEET_EASE = [0.18, 0.08, 0.24, 1] as const

/** Apple's own sheet length, and the one every sheet here presents on. */
export const SHEET_DURATION = 0.5
