import type { Transition } from 'motion/react'

/** Shared-element id pairing the destination input text with the amount-scene recipient text. */
export const SEND_RECIPIENT_LAYOUT_ID = 'send-recipient-text'

/** Shared-element id pairing the editing-hero amount with its confirm-ticket counterpart. */
export const SEND_AMOUNT_LAYOUT_ID = 'send-amount-hero'

/** Both morph endpoints must animate with the same spring or the pairing looks broken. */
export function recipientMorphTransition(reduceMotion: boolean | null): Transition {
  return reduceMotion ? { layout: { duration: 0.01 } } : { layout: { type: 'spring', bounce: 0, duration: 0.32 } }
}
