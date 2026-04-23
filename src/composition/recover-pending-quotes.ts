/**
 * Composition-level function for recovering pending mint quotes.
 * Assembles adapters and delegates to cashu-recovery.
 */
export async function recoverPendingQuotes(activeMintUrls?: string[]): Promise<{
  recovered: number
  failed: number
  expired: number
}> {
  const { recoverPendingQuotes: doRecover } = await import('@/modules/cashu/internal/cashu-recovery')
  const { getQuoteRecoveryOps } = await import('@/modules/cashu/internal/cashu-backend')
  const { DexiePendingOperationRepository } = await import('@/adapters/storage/dexie/dexie-pending-operation.repository')
  const { DexieTransactionRepository } = await import('@/adapters/storage/dexie/dexie-transaction.repository')
  return doRecover({
    pendingOpRepo: new DexiePendingOperationRepository(),
    txRepo: new DexieTransactionRepository(),
    quoteOps: await getQuoteRecoveryOps(),
    activeMintUrls,
  })
}
