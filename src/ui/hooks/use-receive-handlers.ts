import { useCallback } from 'react'
import { sat } from '@/core/domain/amount'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { PendingIncomingReview } from '@/core/types'
import type { POSDevice } from '@/core/types/wallet'
import { useRedeemToken } from '@/ui/hooks/use-redeem-token'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { normalizeMintUrl, isSameMintUrl } from '@/utils/url'

/**
 * Function surface of composition/incoming-review.resolveIncomingReview. MainApp
 * injects it so the hook never imports composition directly (core ports only, at
 * both runtime and type level). Structural mismatches (e.g. added fields) surface
 * at compile time via the assignability check at the injection site.
 */
export type ResolveIncomingReviewFn = (
  deps: {
    processedStore: Pick<ProcessedStore, 'save'>
    receiveRequest: Pick<ReceiveRequestUseCase, 'findByRequestId' | 'complete'>
    removeIncomingReview: (externalId: string) => void | Promise<void>
    nostrGateway?: Pick<NostrGateway, 'getRelayStatus' | 'sendPrivateDirectMessage'>
    posDevices?: POSDevice[] | undefined
  },
  params: {
    review: PendingIncomingReview
    transactionId?: string
  },
) => Promise<void>

export interface UseReceiveHandlersDeps {
  serviceRegistry: ServiceRegistry | null
  /** useTransactions().refreshAll — atomic balance+tx refresh; shared contract, don't split */
  refreshAll: () => Promise<void>
  /** Injected composition/incoming-review.resolveIncomingReview */
  resolveReview: ResolveIncomingReviewFn
  /** UI reset after a confirmed rejection (clear review/scan params + return to
   *  the previous screen). Injected as a callback since screen params and nav
   *  state are owned by MainApp. */
  onRejected: () => void
}

export interface ReceiveHandlers {
  handleCreateInvoice: (
    amount: number,
    mintUrl: string,
  ) => Promise<{ invoice: string; quoteId: string; expiry: number } | null>
  handleReceiveToken: ReturnType<typeof useRedeemToken>
  handleReceiveRequestFulfillment: (
    token: string,
    paymentRef: string,
  ) => Promise<{ success: boolean; amount?: number; requestFulfilled?: boolean; error?: { code?: string; message?: string } }>
  handleResolveIncomingReview: (params: {
    review: PendingIncomingReview
    transactionId?: string
  }) => Promise<void>
  handleRejectIncomingReview: (review: PendingIncomingReview) => Promise<void>
  handlePaymentReceived: (receivedAmount: number, type: 'lightning' | 'ecash') => Promise<void>
}

/**
 * Receive handler bundle: invoice creation, token redemption, ReceiveRequest
 * fulfillment, untrusted-mint review approve/reject, and receive-complete
 * broadcast.
 *
 * The success path uses the injected atomic refresh so a tx-only or balance-only
 * window is never created.
 */
export function useReceiveHandlers(deps: UseReceiveHandlersDeps): ReceiveHandlers {
  const { serviceRegistry, refreshAll, resolveReview, onRejected } = deps

  const settings = useAppStore((state) => state.settings)
  const removeIncomingReview = useAppStore((state) => state.removeIncomingReview)

  const handleCreateInvoice = useCallback(async (amount: number, mintUrl: string) => {
    if (!mintUrl) return null

    if (!serviceRegistry?.payment) {
      console.warn('[useReceiveHandlers] ServiceRegistry not ready — cannot create invoice')
      return null
    }
    const transfer = await serviceRegistry.transferLifecycle.initiateIncomingTransfer(
      { txId: crypto.randomUUID(), accountId: mintUrl, amount: sat(amount) }, 'bolt11'
    )

    const ref = transfer.transportRef as { request?: string, quoteId?: string }

    return {
      invoice: ref?.request ?? '',
      quoteId: ref?.quoteId ?? '',
      expiry: transfer.expiresAt ? Math.floor(transfer.expiresAt / 1000) : Math.floor(Date.now() / 1000) + 600,
    }
  }, [serviceRegistry])

  const handleReceiveToken = useRedeemToken(serviceRegistry, () => {
    refreshAll().catch((e) => console.error('[useReceiveHandlers] refreshAll after receive failed:', e))
  })

  /**
   * Handle an incoming token that fulfills one of MY ReceiveRequests.
   * Routes through the domain use case so settlement → my-id verification →
   * intent='request-fulfill' tagging happens in one place. Transport-agnostic
   * (HTTP polling, future transports). Uses paymentRef as both externalId
   * (idempotency / deterministic txId) and the receive-request match key.
   */
  const handleReceiveRequestFulfillment = useCallback(async (
    token: string,
    paymentRef: string,
  ): Promise<{ success: boolean; amount?: number; requestFulfilled?: boolean; error?: { code?: string; message?: string } }> => {
    if (!serviceRegistry?.incomingPayment) {
      return { success: false, error: { code: 'NOT_READY', message: 'ServiceRegistry not ready' } }
    }

    const result = await serviceRegistry.incomingPayment.processIncoming({
      payload: token,
      externalId: paymentRef,
      receiveRequestPaymentRef: paymentRef,
      receiveRequestMethod: 'ecash',
    })

    if (result.status === 'success') {
      refreshAll().catch((e) => console.error('[useReceiveHandlers] refreshAll after fulfillment failed:', e))
      return { success: true, amount: result.amount, requestFulfilled: result.requestFulfilled }
    }
    if (result.status === 'already_processed') {
      return { success: true, amount: 0 }
    }
    return { success: false, error: { code: 'FULFILLMENT_FAILED', message: result.error ?? 'Failed to process incoming payment' } }
  }, [serviceRegistry, refreshAll])

  const handleResolveIncomingReview = useCallback(async (params: {
    review: PendingIncomingReview
    transactionId?: string
  }) => {
    if (!serviceRegistry) return

    await resolveReview({
      processedStore: serviceRegistry.processedStore,
      receiveRequest: serviceRegistry.receiveRequest,
      // Remove from the durable queue; the queue adapter syncs the Zustand mirror
      removeIncomingReview: (externalId) =>
        serviceRegistry.incomingReviewQueue.remove(externalId),
      nostrGateway: serviceRegistry.nostrGateway,
      posDevices: settings.posDevices,
    }, params)

    // Approval via trust-add: auto-redeem the remaining pending reviews for the
    // same mint — trusting a mint is approval. Runs after the modal's own redeem
    // so it doesn't race the active review. Skipped for untrusted mints (avoids
    // auto-discard). Read mints fresh from the store: in the "trust and receive"
    // flow this callback continues in the same render closure as the trust-add,
    // so the captured prop would still hold the pre-trust value.
    const reviewMint = normalizeMintUrl(params.review.token.mintUrl)
    const currentMints = useAppStore.getState().settings.mints
    if (currentMints.some((m) => isSameMintUrl(m, reviewMint))) {
      serviceRegistry.recoveryScheduler
        .drainReviewQueue(reviewMint)
        .catch((e) => console.warn('[useReceiveHandlers] review drain failed:', e))
    }
  }, [serviceRegistry, resolveReview, settings.posDevices])

  const handleRejectIncomingReview = useCallback(async (review: PendingIncomingReview) => {
    if (serviceRegistry) {
      await serviceRegistry.processedStore.save({
        externalId: review.externalId,
        processedAt: Date.now(),
        result: 'skipped',
        error: 'Rejected by user',
      })
      // Remove from the durable queue; otherwise it revives on the next boot hydrate
      await serviceRegistry.incomingReviewQueue.remove(review.externalId)
    } else {
      removeIncomingReview(review.externalId)
    }

    onRejected()
  }, [serviceRegistry, removeIncomingReview, onRejected])

  // Lightning toast is handled globally by bridge.ts (mint-quote:redeemed)
  const handlePaymentReceived = useCallback(async (
    _receivedAmount: number,
    _type: 'lightning' | 'ecash',
  ) => {
    refreshAll().catch((e) => console.error('[useReceiveHandlers] refreshAll after payment received:', e))
    broadcastSync('balance_changed')
  }, [refreshAll])

  return {
    handleCreateInvoice,
    handleReceiveToken,
    handleReceiveRequestFulfillment,
    handleResolveIncomingReview,
    handleRejectIncomingReview,
    handlePaymentReceived,
  }
}
