import type { TransactionMgmtUseCase } from '@/core/ports/driving/transaction-mgmt.usecase'
import { matchesTokenReceipt } from '@/core/domain/payment-receipt'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { PendingIncomingReview } from '@/core/types'
import type { POSDevice } from '@/core/types/wallet'

export interface ResolveIncomingReviewDeps {
  transactionMgmt?: Pick<TransactionMgmtUseCase, 'getById' | 'update'>
  processedStore: Pick<ProcessedStore, 'save'>
  receiveRequest: Pick<ReceiveRequestUseCase, 'findByRequestId' | 'complete'>
  /** Durable-queue removal path; the queue adapter keeps the Zustand mirror in sync */
  removeIncomingReview: (externalId: string) => void | Promise<void>
  nostrGateway?: Pick<NostrGateway, 'getRelayStatus' | 'sendPrivateDirectMessage'>
  posDevices?: POSDevice[] | undefined
}

export async function resolveIncomingReview(
  deps: ResolveIncomingReviewDeps,
  params: {
    review: PendingIncomingReview
    transactionId?: string
  },
): Promise<void> {
  const { review, transactionId } = params
  if (transactionId && review.senderPubkey && review.recipientPubkey && deps.transactionMgmt) {
    let transaction = await deps.transactionMgmt.getById(transactionId)
    // The transfer bridge persists the receipt asynchronously.
    for (let attempt = 0; !transaction && attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      transaction = await deps.transactionMgmt.getById(transactionId)
    }
    const gross = review.token.amount.value
    if (!matchesTokenReceipt(transaction, review.token))
      throw new Error('Incoming receipt does not match the approved token')
    await deps.transactionMgmt.update(transactionId, {
      metadata: { ...transaction.metadata, paymentDelivery: {
        id: review.externalId, sender: review.senderPubkey, recipient: review.recipientPubkey,
        amount: Number(gross),
        ...(review.requestId ? { requestId: review.requestId } : {}),
      } },
    })
  }
  await completeLinkedReceiveRequest(deps.receiveRequest, params.review)

  await deps.processedStore.save({
    externalId: params.review.externalId,
    txId: params.transactionId,
    processedAt: Date.now(),
    result: 'success',
  })

  await deps.removeIncomingReview(params.review.externalId)
  await maybeAckIncomingReview(deps, params.review)
}

async function completeLinkedReceiveRequest(
  receiveRequest: Pick<ReceiveRequestUseCase, 'findByRequestId' | 'complete'>,
  review: PendingIncomingReview,
): Promise<void> {
  if (!review.requestId) {
    return
  }

  const request = await receiveRequest.findByRequestId(review.requestId)
  if (request) {
    await receiveRequest.complete(request.id, 'ecash')
  }
}

async function maybeAckIncomingReview(
  deps: Pick<ResolveIncomingReviewDeps, 'nostrGateway' | 'posDevices'>,
  review: PendingIncomingReview,
): Promise<void> {
  if (!deps.nostrGateway || !review.senderPubkey || !review.txId) {
    return
  }

  if (!deps.posDevices?.some((device) => device.nostrPublicKey === review.senderPubkey)) {
    return
  }

  const relays = deps.nostrGateway
    .getRelayStatus()
    .filter((relay) => relay.connected)
    .map((relay) => relay.url)

  if (relays.length === 0) {
    return
  }

  try {
    await deps.nostrGateway.sendPrivateDirectMessage({
      recipientPubkey: review.senderPubkey,
      content: JSON.stringify({ type: 'delivery_ack', txId: review.txId }),
      relays,
    })
  } catch (error) {
    console.warn('[IncomingReview] Failed to send delivery ACK:', error)
  }
}
