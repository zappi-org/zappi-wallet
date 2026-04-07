import { useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'
import { ServiceContext } from '@/hooks/service-context-value'
import type { RecoveryReport } from '@/core/ports/driving/payment.usecase'

/** Sum all recovery counts into a single total */
export function totalRecoveredCount(reports: RecoveryReport[]): number {
  return reports.reduce((sum, r) => sum + r.recovered, 0)
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
  const registry = useContext(ServiceContext)
  const addToast = useAppStore((state) => state.addToast)
  const setPendingQuotes = useAppStore((state) => state.setPendingQuotes)

  /** Show toast if items were recovered */
  const notifyRecovery = useCallback((reports: RecoveryReport[] | null) => {
    if (!reports) return
    const total = totalRecoveredCount(reports)
    if (total > 0) {
      addToast({
        type: 'success',
        message: t('toast.offlineTokensRedeemed', { count: total }),
        duration: 4000,
      })
    }
  }, [addToast, t])

  /** Load active pending quotes into store */
  const syncPendingQuotes = useCallback(async () => {
    try {
      if (registry?.pendingItems) {
        const activeQuotes = await registry.pendingItems.getActivePendingQuotes()
        setPendingQuotes(activeQuotes)
      }
    } catch (e) {
      console.error('[Sync] Failed to sync pending quotes:', e)
    }
  }, [setPendingQuotes, registry])

  /** Full post-recovery sync: notify → refresh balance/tx → broadcast → quotes */
  const syncAfterRecovery = useCallback(async (reports: RecoveryReport[] | null) => {
    notifyRecovery(reports)
    await refreshAll()
    broadcastSync('balance_changed')
    await syncPendingQuotes()
  }, [notifyRecovery, refreshAll, syncPendingQuotes])

  return { notifyRecovery, syncPendingQuotes, syncAfterRecovery, totalRecoveredCount }
}
