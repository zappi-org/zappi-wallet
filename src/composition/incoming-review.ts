import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { PendingIncomingReview } from '@/core/types'
import type { POSDevice } from '@/core/types/wallet'

export interface ResolveIncomingReviewDeps {
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
