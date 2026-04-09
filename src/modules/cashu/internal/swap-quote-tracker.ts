/**
 * Swap quote tracking — shared state for suppressing swap-related toasts.
 * Originally in coco/bridge.ts, moved to modules/cashu/internal/ for proper encapsulation.
 */

const swapQuoteIds = new Set<string>()

export function markQuoteAsSwap(quoteId: string): void {
  swapQuoteIds.add(quoteId)
}

export function unmarkQuoteAsSwap(quoteId: string): void {
  swapQuoteIds.delete(quoteId)
}

export function isSwapQuote(quoteId: string): boolean {
  return swapQuoteIds.has(quoteId)
}
