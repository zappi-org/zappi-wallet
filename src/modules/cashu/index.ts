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

export {
  getActivePendingQuotes,
  prepareSend,
  executeSend,
  rollbackSend,
  prepareMelt,
  executeMelt,
  rollbackMelt,
  createMintQuote,
  redeemMintQuote,
  type LockingCondition,
} from './internal/cashu-backend'
export type { MetadataStore } from './internal/metadata-store'
// clearWalletCache removed — was a no-op function (cashu-ts wallet cache no longer used)
export { isSwapQuote, markQuoteAsSwap, unmarkQuoteAsSwap } from './internal/swap-quote-tracker'
export { setCachedMnemonic, clearCachedMnemonic, injectSeedCache } from './internal/seed-getter'

// Legacy Cashu service functions (until fully migrated to cashu-backend)
export {
  rollbackSendToken,
  prepareSendToken,
  executeSendToken,
  receiveToken,
  receiveP2PKToken,
  sendToken,
  getBalances,
  restoreWallet,
  recoverPendingMelts,
  recoverPendingSendTokens,
  addMint,
  recoverPendingQuotes,
} from './internal/cashu-service-legacy'
