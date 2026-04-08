/**
 * Legacy re-export — implementation moved to modules/cashu/internal/coco-sdk.ts
 * This file exists for backward compatibility with services/ that still import @/coco/manager.
 * Will be deleted when coco/ directory is removed.
 */
export {
  getCocoManager,
  resetCocoManager,
  isCocoInitialized,
  deleteCocoData,
  enableWatchers,
  recheckPendingMintQuotes,
  getPendingMintQuotes,
  getMintQuote,
} from '@/modules/cashu/internal/coco-sdk'
