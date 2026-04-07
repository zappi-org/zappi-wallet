/**
 * Composition root for PendingItemsUseCase
 */

import { PendingItemsService, type PendingItemsDataSource } from '@/core/services/pending-items.service'
import type { PendingItemsUseCase } from '@/core/ports/driving/pending-items.usecase'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { getDatabase } from '@/data/database/schema'
import { getPendingReceiveRequests } from '@/services/receive-request'
import { getActivePendingQuotes } from '@/coco/cashuService'

export function createPendingItemsService(txRepo: TransactionRepository): PendingItemsUseCase {
  const dataSource: PendingItemsDataSource = {
    async getPendingReceivedTokens(mintVariants) {
      const db = getDatabase()
      return mintVariants
        ? db.pendingReceivedTokens.where('mintUrl').anyOf(mintVariants).toArray()
        : db.pendingReceivedTokens.toArray()
    },

    async getPendingReceiveRequests(mintVariants) {
      return getPendingReceiveRequests(mintVariants)
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
