export { classifyCashuError } from './internal/classify-error'

// Public API for Cashu module operations
// External code accesses via @/modules/cashu/ instead of @/coco/
export {
  getCocoManager,
  deleteCocoData,
  enableWatchers,
  recheckPendingMintQuotes,
  getMintQuote,
  abandonMintQuote,
  removeMintFromCoco,
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
export { createExternalMnemonicRecovery } from './internal/external-mnemonic-recovery'

// Additional cashu-backend exports
export {
  restoreWallet,
  addMint,
  decodeTokenForPaymentPayload,
  getMintInfoFromCoco,
  getMintOpStateLocal,
  requeuePaidMintQuotesInCoco,
  runCocoRecoverySweeps,
  getSendRecoveryOps,
} from './internal/cashu-backend'

// Recovery behavior units — for RecoveryScheduler wiring
export {
  reconcileCashu,
  recoverLegacySendTokens,
} from './internal/cashu-recovery'
export { redeemPendingReceivedTokens } from './internal/offline-token-recovery'
