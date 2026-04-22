/**
 * useOwnPaymentEvent — declares that the current screen owns UI feedback for
 * a given transaction's completion. While mounted, the global
 * `useGlobalTokenClaimToast` suppresses its toast for that txId, so the
 * dedicated full-screen UX plays without duplicate notifications.
 *
 * Pass `undefined` when the txId isn't known yet; the subscription is a no-op.
 */

import { useEffect } from 'react'
import {
  markPaymentOwnedByUI,
  unmarkPaymentOwnedByUI,
} from '@/ui/utils/payment-event-consumers'

export function useOwnPaymentEvent(txId: string | undefined): void {
  useEffect(() => {
    if (!txId) return
    markPaymentOwnedByUI(txId)
    return () => unmarkPaymentOwnedByUI(txId)
  }, [txId])
}
