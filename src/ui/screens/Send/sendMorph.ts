import type { Transition } from 'motion/react'

/** Shared-element id pairing the destination input text with the amount-scene recipient text. */
export const SEND_RECIPIENT_LAYOUT_ID = 'send-recipient-text'

/** Both morph endpoints must animate with the same spring or the pairing looks broken. */
export function recipientMorphTransition(reduceMotion: boolean | null): Transition {
  return reduceMotion ? { layout: { duration: 0.01 } } : { layout: { type: 'spring', bounce: 0, duration: 0.32 } }
}
