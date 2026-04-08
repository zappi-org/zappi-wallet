export { classifyCashuError } from './internal/classify-error'

// Public API for Cashu module operations
// Phase 7: 외부에서 @/coco/ 대신 @/modules/cashu/ 경유로 접근
export {
  getCocoManager,
  deleteCocoData,
  enableWatchers,
  recheckPendingMintQuotes,
  getMintQuote,
} from './internal/coco-sdk'

export { getActivePendingQuotes } from './internal/cashu-backend'
// clearWalletCache removed — was a no-op function (cashu-ts wallet cache no longer used)
export { isSwapQuote, markQuoteAsSwap, unmarkQuoteAsSwap } from './internal/swap-quote-tracker'
export { setCachedMnemonic, clearCachedMnemonic } from './internal/seed-getter'
