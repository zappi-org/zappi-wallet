/**
 * Pre-unlock infrastructure — unlock 전에 필요한 인프라
 *
 * ServiceRegistry(BootstrapResult)는 unlock 후에만 생성 가능.
 * 앱 초기화 시 settings 로드, transaction 이력 로드 등은
 * unlock 전에도 필요하므로 별도 팩토리로 제공.
 */

import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { DexieTransactionRepository } from '@/adapters/storage/dexie/dexie-transaction.repository'
import { FailedIncomingStoreAdapter } from '@/adapters/storage/failed-incoming-store.adapter'
import { exchangeRateService } from './exchange-rate'
import { DexieReceiveRequestRepository } from '@/adapters/storage/dexie/dexie-receive-request.repository'
import { useAppStore } from '@/store'
import type { Transaction } from '@/core/domain/transaction'
import type { DisplaySnapshot } from '@/core/domain/transaction'
import { hiddenPendingReceiveTransactionRefs, isVisibleTransaction } from '@/core/domain/transaction-visibility'
import { toNumber } from '@/core/domain/amount'
import { satsToFiat } from '@/utils/format'

export interface PreUnlockServices {
  settingsRepo: SettingsRepository
  txRepo: {
    findAll(filter?: { limit?: number }): Promise<Transaction[]>
    deleteAll(): Promise<void>
    deleteOlderThan(days: number): Promise<void>
  }
  failedIncomingStore: FailedIncomingStoreAdapter
  exchangeRate: {
    loadCachedRates(): Promise<void>
    fetchRates(): void
    refreshIfStale(): Promise<void>
  }
  cleanupExpiredReceiveRequests(): Promise<number>
}

function getDisplaySnapshotProvider(): () => ((amountSats: number) => DisplaySnapshot | undefined) {
  return () => (amountSats: number) => {
    const state = useAppStore.getState()
    const currency = state.settings.fiatCurrency ?? 'USD'
    const show = state.settings.showFiatConversion ?? true
    const rate = state.allRates?.[currency] ?? null
    if (!show || !rate) return undefined
    return { amount: satsToFiat(amountSats, rate), currency, rate }
  }
}

export function createPreUnlockServices(): PreUnlockServices {
  const dexieRepo = new DexieTransactionRepository()
  const receiveRequestRepo = new DexieReceiveRequestRepository()
  const getEnricher = getDisplaySnapshotProvider()

  // Wrap domain repo to enrich with displaySnapshot on save
  const txRepo = {
    async findAll(filter?: { limit?: number }): Promise<Transaction[]> {
      const [txs, receiveRequests] = await Promise.all([
        dexieRepo.findAll(filter),
        receiveRequestRepo.listAll(),
      ])
      const hiddenReceiveRefs = hiddenPendingReceiveTransactionRefs(receiveRequests)
      const enrich = getEnricher()
      return txs
        .filter((tx) => isVisibleTransaction(tx, hiddenReceiveRefs))
        .map((tx) => {
          if (tx.displaySnapshot) return tx
          const snapshot = enrich(toNumber(tx.amount))
          return snapshot ? { ...tx, displaySnapshot: snapshot } : tx
        })
    },
    async deleteAll(): Promise<void> {
      await dexieRepo.deleteAll()
    },
    async deleteOlderThan(days: number): Promise<void> {
      await dexieRepo.deleteOlderThan(days)
    },
  }

  return {
    settingsRepo: new SettingsRepository(),
    txRepo,
    failedIncomingStore: new FailedIncomingStoreAdapter(),
    exchangeRate: {
      loadCachedRates: () => exchangeRateService.loadCachedRates(),
      fetchRates: () => { exchangeRateService.fetchRates().catch(() => {}) },
      refreshIfStale: () => exchangeRateService.refreshIfStale(),
    },
    cleanupExpiredReceiveRequests: () => receiveRequestRepo.cleanupExpired(),
  }
}

export type { Transaction }
