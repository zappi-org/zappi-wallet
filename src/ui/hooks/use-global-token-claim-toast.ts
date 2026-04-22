/**
 * useGlobalTokenClaimToast — emits a toast whenever one of the user's
 * outgoing ecash tokens is claimed by the recipient.
 *
 * Skipped when a dedicated UI (e.g. TokenCreate/CreatedStep) already owns
 * feedback for that txId — see `useOwnPaymentEvent` and
 * `payment-event-consumers`.
 *
 * Accepts the registry as an argument because MainApp (where this hook is
 * mounted) lives outside the ServiceProvider it renders.
 */

import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useFormatSats } from '@/utils/format'
import { hapticSuccess } from '@/ui/utils/haptic'
import { toNumber } from '@/core/domain/amount'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { isPaymentOwnedByUI } from '@/ui/utils/payment-event-consumers'

export function useGlobalTokenClaimToast(
  registry: ServiceRegistry | null,
): void {
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()

  useEffect(() => {
    if (!registry?.eventBus) return
    const unsub = registry.eventBus.on('payment:completed', (event) => {
      const txId = event.payload.txId
      if (isPaymentOwnedByUI(txId)) return

      registry.transactionMgmt
        .getById(txId)
        .then((tx) => {
          if (!tx) return
          if (tx.protocol !== 'cashu-token') return
          if (tx.direction !== 'send') return
          if (tx.outcome !== 'claimed') return

          const amountSats = toNumber(tx.amount)
          const message = tx.memo
            ? `토큰 ${formatSats(amountSats)} 이 사용되었어요 · ${tx.memo}`
            : `토큰 ${formatSats(amountSats)} 이 사용되었어요`

          addToast({ type: 'success', message, duration: 5000 })
          hapticSuccess()
        })
        .catch(() => {
          /* resolve failed — ignore */
        })
    })
    return unsub
  }, [registry, addToast, formatSats])
}
