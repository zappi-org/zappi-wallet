/**
 * useGlobalTokenClaimToast — emits a toast whenever one of the user's
 * outgoing ecash tokens is claimed by the recipient.
 *
 * Two settlement paths reach an outgoing ecash claim and either may win the
 * race, so this hook subscribes to BOTH and fires the same specific toast:
 *  - `send:claimed` (OLD domain path via ReclaimService.finalizeSend) — payload
 *    is self-contained (amount, memo, protocol).
 *  - `transfer:settled` (NEW TransferLifecycle path) — outgoing ecash claims
 *    carry no semantic event, so we read amount/memo/protocol off the transfer.
 * A shared txId dedup set guarantees a claim that emits both events toasts once.
 *
 * Skipped when a dedicated UI (e.g. Send/DirectReceiptStep) already owns
 * feedback for that txId — see `useOwnPaymentEvent`.
 *
 * Accepts the registry as an argument because MainApp (where this hook is
 * mounted) lives outside the ServiceProvider it renders.
 */

import { useEffect, useRef } from 'react'
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

  // Shared across both handlers so a claim that emits send:claimed AND
  // transfer:settled toasts once. Session-scoped (MainApp lifetime), bounded by
  // the number of distinct claimed sends — a ref so it survives effect re-runs.
  const toastedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!registry?.eventBus) return

    const fireClaimToast = (amountSats: number, memo?: string): void => {
      const message = memo
        ? t('toast.tokenClaimedWithMemo', { amount: formatSats(amountSats), memo })
        : t('toast.tokenClaimed', { amount: formatSats(amountSats) })
      addToast({ type: 'success', message, duration: 5000 })
      hapticSuccess()
    }

    // OLD domain path.
    const unsubSendClaimed = registry.eventBus.on('send:claimed', (event) => {
      const { txId, amount, memo, protocol } = event.payload
      // Alpha scope: only cashu ecash token claims — Lightning sends already
      // have their own completion toast via payment:completed handler.
      if (protocol !== 'cashu-token') return
      // Record before the ownership check: the owning screen already showed
      // feedback (the stamp), so the other settlement path must not re-toast
      // once ownership is released — dedup has to survive the early return below.
      if (toastedRef.current.has(txId)) return
      toastedRef.current.add(txId)
      if (isPaymentOwnedByUI(txId)) return
      fireClaimToast(toNumber(amount), memo)
    })

    // NEW TransferLifecycle path: outgoing ecash claims emit no send:claimed.
    const unsubTransferSettled = registry.eventBus.on('transfer:settled', (event) => {
      const { transfer } = event.payload
      if (transfer.direction !== 'outgoing') return
      // transportRef.type tags the protocol: 'ecash-token' → 'ecash' (cashu),
      // 'bolt11-melt' → 'bolt11'. Only cashu claims get this specific toast.
      const ref = transfer.transportRef as
        | { type?: string; protocol?: string; amount?: number; memo?: string }
        | undefined
      const protocol = ref?.protocol || ref?.type?.split('-')[0]
      if (protocol !== 'ecash') return
      // Record before the ownership check — see send:claimed above for why.
      if (toastedRef.current.has(transfer.txId)) return
      toastedRef.current.add(transfer.txId)
      if (isPaymentOwnedByUI(transfer.txId)) return
      // transfer.amount is unset for ecash prepares — amount lives on transportRef.
      fireClaimToast(transfer.amount ?? ref?.amount ?? 0, ref?.memo)
    })

    return () => {
      unsubSendClaimed()
      unsubTransferSettled()
    }
  }, [registry, addToast, formatSats, t])
}
