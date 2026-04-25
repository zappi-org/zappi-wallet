/**
 * Composition-level function for recovering pending mint quotes.
 * Assembles adapters and delegates to cashu-recovery.
 */
export async function recoverPendingQuotes(activeMintUrls?: string[]): Promise<{
  recovered: number
  failed: number
  expired: number
}> {
  const { createCashuBackend } = await import('@/modules/cashu/create-cashu-backend')
  const { DexiePendingOperationRepository } = await import('@/adapters/storage/dexie/dexie-pending-operation.repository')
  const { DexieTransactionRepository } = await import('@/adapters/storage/dexie/dexie-transaction.repository')
  const { DexieOfflineTokenStore } = await import('@/adapters/storage/dexie/dexie-offline-token-store')
  const backend = createCashuBackend({
    pendingOpRepo: new DexiePendingOperationRepository(),
    txRepo: new DexieTransactionRepository(),
    offlineTokenStore: new DexieOfflineTokenStore(),
    getActiveMintUrls: activeMintUrls === undefined ? undefined : () => activeMintUrls,
  })
  return backend.recoverPendingQuotes()
}
