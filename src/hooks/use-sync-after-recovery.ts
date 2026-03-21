import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'
import type { PaymentService } from '@/services/payment/payment.service'

export type RecoverAllResult = Awaited<ReturnType<PaymentService['recoverAll']>>

/** Sum all recovery counts into a single total */
export function totalRecoveredCount(recovery: RecoverAllResult): number {
  return recovery.quotes.recovered + recovery.melts.recovered + recovery.sendTokens.reclaimed + recovery.receivedTokens.redeemed
}

interface UseSyncAfterRecoveryParams {
  refreshAll: () => Promise<void>
}

/**
 * Post-recovery sync, split by domain:
 * - notifyRecovery: toast notification
 * - syncPendingQuotes: pending quotes store sync
 * - syncAfterRecovery: full combo (notify → refresh → broadcast → quotes)
 */
export function useSyncAfterRecovery({ refreshAll }: UseSyncAfterRecoveryParams) {
  const { t } = useTranslation()
  const addToast = useAppStore((state) => state.addToast)
  const setPendingQuotes = useAppStore((state) => state.setPendingQuotes)

  /** Show toast if offline tokens were redeemed */
  const notifyRecovery = useCallback((recovery: RecoverAllResult | null) => {
    if (recovery && totalRecoveredCount(recovery) > 0) {
      if (recovery.receivedTokens.redeemed > 0) {
        addToast({
          type: 'success',
          message: t('toast.offlineTokensRedeemed', { count: recovery.receivedTokens.redeemed }),
          duration: 4000,
        })
      }
    }
  }, [addToast, t])

  /** Load active pending quotes into store */
  const syncPendingQuotes = useCallback(async () => {
    try {
      const { getActivePendingQuotes } = await import('@/coco/cashuService')
      const activeQuotes = await getActivePendingQuotes()
      setPendingQuotes(activeQuotes)
    } catch (e) {
      console.error('[Sync] Failed to sync pending quotes:', e)
    }
  }, [setPendingQuotes])

  /** Full post-recovery sync: notify → refresh balance/tx → broadcast → quotes */
  const syncAfterRecovery = useCallback(async (recovery: RecoverAllResult | null) => {
    notifyRecovery(recovery)
    await refreshAll()
    broadcastSync('balance_changed')
    await syncPendingQuotes()
  }, [notifyRecovery, refreshAll, syncPendingQuotes])

  return { notifyRecovery, syncPendingQuotes, syncAfterRecovery, totalRecoveredCount }
}
