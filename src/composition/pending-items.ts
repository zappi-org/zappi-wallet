/**
 * Composition root for PendingItemsUseCase
 */

import { PendingItemsService, type PendingItemsDataSource } from '@/core/services/pending-items.service'
import type { PendingItemsUseCase } from '@/core/ports/driving/pending-items.usecase'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { getDatabase } from '@/adapters/storage/dexie/schema'
import { stripTrailingSlash } from '@/utils/url'
import { getActivePendingQuotes } from '@/modules/cashu'

export function createPendingItemsService(txRepo: TransactionRepository): PendingItemsUseCase {
  const dataSource: PendingItemsDataSource = {
    async getPendingReceivedTokens(mintVariants) {
      const db = getDatabase()
      return mintVariants
        ? db.pendingReceivedTokens.where('mintUrl').anyOf(mintVariants).toArray()
        : db.pendingReceivedTokens.toArray()
    },

    async getPendingReceiveRequests(mintVariants) {
      const db = getDatabase()
      const now = Date.now()
      const results = await db.receiveRequests.where('status').equals('pending').toArray()
      const normalizedMints = mintVariants?.map(stripTrailingSlash)
      return results.filter((r) => {
        if (r.expiresAt <= now) return false
        if (normalizedMints && normalizedMints.length > 0) {
          return normalizedMints.includes(stripTrailingSlash(r.mintUrl))
        }
        return true
      })
    },

    async getPendingSendTokens(mintVariants) {
      const db = getDatabase()
      return mintVariants
        ? db.pendingSendTokens.where('mintUrl').anyOf(mintVariants).toArray()
        : db.pendingSendTokens.toArray()
    },

    async getActivePendingQuotes() {
      return getActivePendingQuotes()
    },
  }

  return new PendingItemsService(dataSource, txRepo)
}
