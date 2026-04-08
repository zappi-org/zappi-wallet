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

export { getActivePendingQuotes, clearWalletCache } from '@/coco/cashuService'
export { isSwapQuote } from '@/coco/bridge'
export { setCachedMnemonic, clearCachedMnemonic } from '@/coco/seedGetter'
