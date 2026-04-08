/**
 * Pre-unlock infrastructure — unlock 전에 필요한 인프라
 *
 * ServiceRegistry(BootstrapResult)는 unlock 후에만 생성 가능.
 * 앱 초기화 시 settings 로드, transaction 이력 로드 등은
 * unlock 전에도 필요하므로 별도 팩토리로 제공.
 */

import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { getTransactionRepo } from '@/data/repositories/transaction.repository'
import { FailedIncomingStoreAdapter } from '@/adapters/storage/failed-incoming-store.adapter'
import { exchangeRateService } from '@/services/exchange-rate'
import { cleanupExpired as cleanupExpiredReceiveRequests } from '@/services/receive-request'
import { useAppStore } from '@/store'
import type { Transaction } from '@/core/types'

export interface PreUnlockServices {
  settingsRepo: SettingsRepository
  txRepo: ReturnType<typeof getTransactionRepo>
  failedIncomingStore: FailedIncomingStoreAdapter
  exchangeRate: {
    loadCachedRates(): Promise<void>
    fetchRates(): void
    refreshIfStale(): Promise<void>
  }
  cleanupExpiredReceiveRequests(): Promise<number>
}

export function createPreUnlockServices(): PreUnlockServices {
  const txRepo = getTransactionRepo()

  // Inject fiat snapshot provider
  txRepo.setFiatSnapshotProvider(() => {
    const state = useAppStore.getState()
    const currency = state.settings.fiatCurrency ?? 'USD'
    const show = state.settings.showFiatConversion ?? true
    const rate = state.allRates?.[currency] ?? null
    if (!show || !rate) return null
    return { fiatCurrency: currency, exchangeRate: rate }
  })

  return {
    settingsRepo: new SettingsRepository(),
    txRepo,
    failedIncomingStore: new FailedIncomingStoreAdapter(),
    exchangeRate: {
      loadCachedRates: () => exchangeRateService.loadCachedRates(),
      fetchRates: () => { exchangeRateService.fetchRates().catch(() => {}) },
      refreshIfStale: () => exchangeRateService.refreshIfStale(),
    },
    cleanupExpiredReceiveRequests: () => cleanupExpiredReceiveRequests(),
  }
}

/** Legacy transaction repo (singleton, hooks에서 접근 필요) */
export function getLegacyTransactionRepo() {
  return getTransactionRepo()
}

export type { Transaction }
