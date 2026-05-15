import { GIFT_WRAP_SYNC } from '@/core/constants'
import { amount as createAmount } from '@/core/domain/amount'
import {
  candidateAmount,
  candidateMintUrl,
  parseGiftWrapTokenContent,
  type GiftWrapTokenCandidate,
} from '@/core/domain/gift-wrap-token'
import type { EventBus } from '@/core/events/event-bus'
import type { GiftWrapSyncUseCase } from '@/core/ports/driving/gift-wrap-sync.usecase'
import type { IncomingPaymentUseCase } from '@/core/ports/driving/incoming-payment.usecase'
import type { GiftWrapInboxStore } from '@/core/ports/driven/gift-wrap-inbox-store.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type {
  GiftWrapInboxItem,
  GiftWrapInboxSource,
  GiftWrapInboxTokenInfo,
  GiftWrapSyncResult,
} from '@/core/types'
import type { POSDevice } from '@/core/types/wallet'

interface GiftWrapInboxServiceDeps {
  nostrGateway: NostrGateway
  inboxStore: GiftWrapInboxStore
  processedStore: ProcessedStore
  incomingPayment: IncomingPaymentUseCase
  trustedMintProvider: TrustedMintProvider
  incomingReviewQueue: IncomingReviewQueue
  tokenCodec: TokenCodec
  eventBus: EventBus
  getPosDevices?: () => POSDevice[] | undefined
  getPendingRequestId?: () => string | null | undefined
}

interface MaterializedToken {
  token: string
  txId: string
  requestId?: string
  memo?: string
  metadata?: Record<string, unknown>
  mintUrl?: string
  amount?: number
}

export class GiftWrapInboxService implements GiftWrapSyncUseCase {
  private isProcessing = false

  constructor(private readonly deps: GiftWrapInboxServiceDeps) {}

  async ingest(message: UnwrappedMessage, source: GiftWrapInboxSource): Promise<void> {
    await this.deps.inboxStore.upsertMessage(message, source)
  }

  async syncMissed(params: {
    publicKey: string
    relays: string[]
  }): Promise<GiftWrapSyncResult> {
    const result = emptyResult()
    const nowSeconds = Math.floor(Date.now() / 1000)

    for (const relayUrl of params.relays) {
      try {
        const cursor = await this.deps.inboxStore.getRelayCursor(relayUrl)
        const since = cursor
          ? Math.max(0, cursor.lastSeenCreatedAt - GIFT_WRAP_SYNC.TIMESTAMP_OVERLAP_SECONDS)
          : undefined

        const messages = await this.deps.nostrGateway.fetchGiftWraps({
          recipientPubkey: params.publicKey,
          relays: [relayUrl],
          ...(since != null ? { since } : {}),
        })

        result.eventsFetched += messages.length
        let maxCreatedAt = cursor?.lastSeenCreatedAt ?? 0

        for (const message of messages) {
          maxCreatedAt = Math.max(maxCreatedAt, message.createdAt)
          const upserted = await this.deps.inboxStore.upsertMessage(message, 'catch-up')
          if (upserted.inserted) result.eventsIngested++
        }

        await this.deps.inboxStore.saveRelayCursor({
          relayUrl,
          lastSeenCreatedAt: Math.max(maxCreatedAt, nowSeconds),
          updatedAt: Date.now(),
        })
      } catch (error) {
        result.errors.push(`Gift-wrap sync failed for ${relayUrl}: ${String(error)}`)
      }
    }

    const processed = await this.processPending()
    mergeResult(result, processed)
    return result
  }

  async processPending(): Promise<GiftWrapSyncResult> {
    const result = emptyResult()
    if (this.isProcessing) {
      result.errors.push('Gift-wrap processing already in progress')
      return result
    }

    this.isProcessing = true
    try {
      await this.requeueReviewPending(result)
      const now = Date.now()
      const items = await this.deps.inboxStore.claimNext({
        limit: GIFT_WRAP_SYNC.PROCESS_BATCH_LIMIT,
        staleProcessingBefore: now - GIFT_WRAP_SYNC.STALE_PROCESSING_MS,
        retryFailedBefore: now - GIFT_WRAP_SYNC.FAILED_RETRY_DELAY_MS,
        now,
      })

      for (const item of items) {
        await this.processItem(item, result)
      }
    } finally {
      this.isProcessing = false
    }

    return result
  }

  async markReviewed(params: {
    externalId: string
    result: 'success' | 'skipped'
    txId?: string
    error?: string
  }): Promise<void> {
    if (params.result === 'success') {
      await this.deps.inboxStore.markProcessed(params.externalId, params.txId)
      return
    }
    await this.deps.inboxStore.markSkipped(params.externalId, params.error)
  }

  private async requeueReviewPending(result: GiftWrapSyncResult): Promise<void> {
    const reviews = await this.deps.inboxStore.listByStatus('review_pending')
    for (const item of reviews) {
      if (await this.deps.processedStore.exists(item.eventId)) {
        await this.deps.inboxStore.markProcessed(item.eventId, item.txId)
        continue
      }
      if (!item.tokenInfo) continue
      await this.enqueueReview(item, item.tokenInfo)
      result.reviewPending++
    }
  }

  private async processItem(item: GiftWrapInboxItem, result: GiftWrapSyncResult): Promise<void> {
    if (await this.deps.processedStore.exists(item.eventId)) {
      await this.deps.inboxStore.markProcessed(item.eventId, item.txId)
      result.skipped++
      return
    }

    try {
      const candidate = parseGiftWrapTokenContent(item.content, item.eventId, {
        pendingRequestId: this.deps.getPendingRequestId?.() ?? null,
      })
      const directToken = candidate ? this.materializeCandidate(candidate) : null
      if (!directToken) {
        await this.deps.inboxStore.markSkipped(item.eventId, 'No token payload')
        result.skipped++
        result.eventsProcessed++
        return
      }

      const tokenInfo = this.inspectToken(directToken)
      if (!(await this.deps.trustedMintProvider.hasTrustedMint(tokenInfo.mintUrl))) {
        await this.deps.inboxStore.markReviewPending(item.eventId, tokenInfo)
        await this.enqueueReview(item, tokenInfo)
        result.reviewPending++
        result.eventsProcessed++
        return
      }

      const metadata = this.buildMetadata(item, directToken)
      const incoming = await this.deps.incomingPayment.processIncoming({
        payload: directToken.token,
        externalId: item.eventId,
        memo: directToken.memo,
        metadata,
        receiveRequestPaymentRef: directToken.requestId,
        receiveRequestMethod: directToken.requestId ? 'ecash' : undefined,
      })

      if (incoming.status === 'already_processed') {
        await this.deps.inboxStore.markProcessed(item.eventId, `tx-in-${item.eventId}`)
        result.skipped++
        return
      }

      if (incoming.status === 'failed') {
        await this.deps.inboxStore.markFailed(item.eventId, incoming.error ?? 'Incoming payment failed')
        result.failed++
        return
      }

      result.tokensReceived++
      result.amountReceived += incoming.amount ?? 0
      result.eventsProcessed++

      await this.deps.inboxStore.markProcessed(item.eventId, `tx-in-${item.eventId}`)
      this.emitReceiveSettled(item, directToken, incoming.amount ?? 0, incoming.fee, incoming.requestFulfilled, metadata)
      this.maybeAckPOS(item.senderPubkey, directToken.txId)
    } catch (error) {
      await this.deps.inboxStore.markFailed(item.eventId, String(error))
      result.failed++
      result.errors.push(`Failed to process gift-wrap ${item.eventId}: ${String(error)}`)
    }
  }

  private inspectToken(directToken: MaterializedToken): GiftWrapInboxTokenInfo {
    const info = directToken.mintUrl && directToken.amount != null
      ? {
          mint: directToken.mintUrl,
          amount: createAmount(directToken.amount, 'sat'),
          memo: directToken.memo,
        }
      : this.deps.tokenCodec.inspectCashuToken(directToken.token)

    return {
      token: directToken.token,
      mintUrl: info.mint,
      amount: info.amount,
      memo: directToken.memo ?? info.memo,
      requestId: directToken.requestId,
      txId: directToken.txId,
      metadata: directToken.metadata,
    }
  }

  private async enqueueReview(item: GiftWrapInboxItem, tokenInfo: GiftWrapInboxTokenInfo): Promise<void> {
    await this.deps.incomingReviewQueue.enqueue({
      externalId: item.eventId,
      token: {
        type: 'cashu-token',
        token: tokenInfo.token,
        amount: tokenInfo.amount,
        mintUrl: tokenInfo.mintUrl,
        memo: tokenInfo.memo,
      },
      queuedAt: Date.now(),
      requestId: tokenInfo.requestId,
      senderPubkey: item.senderPubkey,
      txId: tokenInfo.txId,
      source: 'gift-wrap',
    })
  }

  private materializeCandidate(candidate: GiftWrapTokenCandidate): MaterializedToken | null {
    if (candidate.kind === 'encoded-token') {
      return {
        token: candidate.token,
        txId: candidate.txId,
        requestId: candidate.requestId,
        memo: candidate.memo,
        metadata: candidate.metadata,
        mintUrl: candidate.mintUrl,
        amount: candidate.amount,
      }
    }

    try {
      const token = this.deps.tokenCodec.encodeCashuToken({
        mint: candidate.mint,
        unit: candidate.unit,
        proofs: candidate.proofs,
        memo: candidate.memo,
      })
      return {
        token,
        txId: candidate.txId,
        requestId: candidate.requestId,
        memo: candidate.memo,
        metadata: candidate.metadata,
        mintUrl: candidateMintUrl(candidate),
        amount: candidateAmount(candidate),
      }
    } catch {
      return null
    }
  }

  private buildMetadata(
    item: GiftWrapInboxItem,
    directToken: MaterializedToken,
  ): Record<string, unknown> {
    return {
      ...directToken.metadata,
      source: 'gift-wrap',
      counterpartyAddressType: 'npub',
      counterpartyPubkey: item.senderPubkey,
      sender: item.senderPubkey,
      eventId: item.eventId,
    }
  }

  private emitReceiveSettled(
    item: GiftWrapInboxItem,
    directToken: MaterializedToken,
    amount: number,
    fee: number | undefined,
    requestFulfilled: boolean | undefined,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.eventBus.emit({
      type: 'receive:settled',
      payload: {
        requestId: directToken.requestId || item.eventId,
        amount,
        fee,
        accountId: 'cashu:ecash',
        method: 'nostr-gift-wrap',
        isSwapStep: false,
        wasRequestFulfilled: requestFulfilled === true,
        metadata,
      },
    })
  }

  private maybeAckPOS(senderPubkey: string, txId: string): void {
    const devices = this.deps.getPosDevices?.()
    if (!devices?.some(d => d.nostrPublicKey === senderPubkey)) return

    const relays = this.deps.nostrGateway.getRelayStatus()
      .filter(r => r.connected)
      .map(r => r.url)

    if (relays.length === 0) return

    this.deps.nostrGateway.sendPrivateDirectMessage({
      recipientPubkey: senderPubkey,
      content: JSON.stringify({ type: 'delivery_ack', txId }),
      relays,
    }).catch(err => console.warn('[GiftWrapInbox] ACK send error:', err))
  }
}

function emptyResult(): GiftWrapSyncResult {
  return {
    eventsFetched: 0,
    eventsIngested: 0,
    eventsProcessed: 0,
    tokensReceived: 0,
    amountReceived: 0,
    reviewPending: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }
}

function mergeResult(target: GiftWrapSyncResult, source: GiftWrapSyncResult): void {
  target.eventsFetched += source.eventsFetched
  target.eventsIngested += source.eventsIngested
  target.eventsProcessed += source.eventsProcessed
  target.tokensReceived += source.tokensReceived
  target.amountReceived += source.amountReceived
  target.reviewPending += source.reviewPending
  target.failed += source.failed
  target.skipped += source.skipped
  target.errors.push(...source.errors)
}
