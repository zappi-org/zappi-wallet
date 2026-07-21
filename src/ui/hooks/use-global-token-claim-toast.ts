/**
 * useGlobalTokenClaimToast — emits a toast whenever one of the user's
 * outgoing ecash tokens is claimed by the recipient.
 *
 * Subscribes to the semantic `send:claimed` domain event. The event payload
 * is self-contained (amount, memo, protocol) so no transaction re-query or
 * direction/outcome filtering is needed in the UI.
 *
 * TODO(TLS): This global toast still listens only to `send:claimed`. Once
 * outgoing ecash token claims are normalized into a semantic event from the
 * TransferLifecycle path, move this hook to that unified event.
 *
 * Skipped when a dedicated UI (e.g. Send/DirectReceiptStep) already owns
 * feedback for that txId — see `useOwnPaymentEvent`.
 *
 * Accepts the registry as an argument because MainApp (where this hook is
 * mounted) lives outside the ServiceProvider it renders.
 */

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useFormatSats } from '@/utils/format'
import { hapticSuccess } from '@/ui/utils/haptic'
import { toNumber } from '@/core/domain/amount'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { isPaymentOwnedByUI } from '@/ui/utils/payment-event-consumers'

export function useGlobalTokenClaimToast(
  registry: ServiceRegistry | null,
): void {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()

  useEffect(() => {
    if (!registry?.eventBus) return
    const unsub = registry.eventBus.on('send:claimed', (event) => {
      const { txId, amount, memo, protocol } = event.payload
      if (isPaymentOwnedByUI(txId)) return
      // Alpha scope: only toast for cashu ecash token claims — Lightning sends
      // already have their own completion toast via payment:completed handler.
      if (protocol !== 'cashu-token') return

      const amountSats = toNumber(amount)
      const message = memo
        ? t('toast.tokenClaimedWithMemo', { amount: formatSats(amountSats), memo })
        : t('toast.tokenClaimed', { amount: formatSats(amountSats) })

      addToast({ type: 'success', message, duration: 5000 })
      hapticSuccess()
    })
    return unsub
  }, [registry, addToast, formatSats, t])
}
