/**
 * Composition root for PendingItemsUseCase
 */

import { PendingItemsService, type PendingItemsDataSource } from '@/core/services/pending-items.service'
import type { PendingItemsUseCase } from '@/core/ports/driving/pending-items.usecase'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import { getDatabase } from '@/adapters/storage/dexie/schema'
import { stripTrailingSlash } from '@/utils/url'
import { getActivePendingQuotes } from '@/modules/cashu'

export function createPendingItemsService(
  txRepo: TransactionRepository,
  receiveRequestRepo: ReceiveRequestRepository,
  modules: WalletModule[],
): PendingItemsUseCase {
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

      // 1. Legacy pendingSendTokens 테이블 (이전 코드에서 생성된 레코드)
      const legacyRecords = mintVariants
        ? await db.pendingSendTokens.where('mintUrl').anyOf(mintVariants).toArray()
        : await db.pendingSendTokens.toArray()

      // 2. PaymentService 경로: transactions 테이블에서 unclaimed send 조회
      const pendingTxs = await db.transactions
        .where('status').equals('pending')
        .filter((tx) => {
          if (tx.direction !== 'send' || tx.tokenState !== 'unspent') return false
          if (!mintVariants) return true
          return mintVariants.includes(tx.mintUrl)
        })
        .toArray()

      const txRecords = pendingTxs.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        mintUrl: tx.mintUrl,
        createdAt: tx.createdAt,
        token: tx.token ?? (tx.metadata?.token as string | undefined),
        operationId: tx.operationId ?? (tx.metadata?.operationId as string | undefined),
      }))

      // 중복 제거 (같은 id가 양쪽에 있을 수 있음)
      const seen = new Set(legacyRecords.map((r) => r.id))
      const merged = [...legacyRecords, ...txRecords.filter((r) => !seen.has(r.id))]
      return merged
    },

    async getActivePendingQuotes() {
      return getActivePendingQuotes()
    },
  }

  return new PendingItemsService(
    dataSource,
    txRepo,
    receiveRequestRepo,
    () => modules.flatMap((module) => module.getPaymentAdapters()),
  )
}
