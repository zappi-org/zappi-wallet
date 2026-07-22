/**
 * NostrIncomingWatcher — adapter layer.
 *
 * NIP-17 gift wrap receive → decrypt/verify → create PendingTransfer → persist to store.
 *
 * This watcher only handles discovery; the resulting PendingTransfer is managed by
 * TransferLifecycleService. Decryption happens inside NostrGatewayAdapter, so this watcher
 * receives an UnwrappedMessage (content, sender, eventId).
 */

import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import type { EventBus } from '@/core/events/event-bus'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import { createPendingTransfer } from '@/core/domain/pending-transfer'
import { toNumber } from '@/core/domain/amount'
import { giftwrapCursorKey } from '@/core/domain/giftwrap-cursor'
import { incrementNetCounter } from '@/adapters/telemetry/net-counters'
import {
  parseGiftWrapTokenContent,
  type GiftWrapTokenCandidate,
} from '@/core/domain/gift-wrap-token'

export class NostrIncomingWatcher {
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly nostrGateway: NostrGateway,
    private readonly transferStore: PendingTransferStore,
    private readonly eventBus: EventBus,
    private readonly processedStore: ProcessedStore,
    private readonly recoveryStore: RecoveryStore,
    private readonly trustedMintProvider: TrustedMintProvider,
    private readonly incomingReviewQueue: IncomingReviewQueue,
    private readonly tokenCodec: TokenCodec,
    private readonly getPendingRequestId: () => string | null,
    /**
     * Persistent relay set used to decide all-EOSE (full-sync). A configured value, not a
     * connection snapshot — a down relay must keep holding the cursor so nothing is lost.
     */
    private readonly getPersistentRelays: () => string[] = () => [],
  ) {}

  start(recipientPubkey: string): void {
    if (this.unsubscribe) return

    this.unsubscribe = this.nostrGateway.subscribeGiftWraps(
      // Apply the cursor window — shrinks each (re)subscription's full-history replay to a
      // lastFullSync − Ω window. Ignored when the gateway has no store injected.
      {
        recipientPubkey,
        cursor: {
          key: giftwrapCursorKey(recipientPubkey),
          fullSyncTargets: this.getPersistentRelays(),
        },
      },
      async (msg) => {
        await this.handleMessage(msg).catch((err) => {
          console.warn('[NostrIncomingWatcher] Failed to process giftwrap:', err)
        })
      },
    )

    console.log('[NostrIncomingWatcher] Started')
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
      console.log('[NostrIncomingWatcher] Stopped')
    }
  }

  // ─── Private ───

  // Two relays can deliver the same event concurrently — the async dedup
  // checks below all race, so a same-event message must wait its turn out.
  private readonly inflightEventIds = new Set<string>()

  private async handleMessage(msg: UnwrappedMessage): Promise<void> {
    // Instrumentation: the deduped-to-received ratio measures replay waste — the basis for
    // comparing before and after the cursor rollout.
    incrementNetCounter('giftwrap_events_received')

    if (this.inflightEventIds.has(msg.eventId)) {
      incrementNetCounter('giftwrap_events_deduped')
      return
    }
    this.inflightEventIds.add(msg.eventId)
    try {
      await this.processMessage(msg)
    } finally {
      this.inflightEventIds.delete(msg.eventId)
    }
  }

  private async processMessage(msg: UnwrappedMessage): Promise<void> {

    // 1. Skip if RecoveryService already processed this eventId (prevents recovery-sync duplicates).
    if (await this.recoveryStore.isProcessed(msg.eventId)) {
      console.log('[NostrIncomingWatcher] Already recovered:', msg.eventId.substring(0, 8))
      incrementNetCounter('giftwrap_events_deduped')
      return
    }

    // 2. Skip if GiftWrapWatcher/IncomingPaymentService already processed this eventId.
    if (await this.processedStore.exists(msg.eventId)) {
      console.log('[NostrIncomingWatcher] Already processed:', msg.eventId.substring(0, 8))
      incrementNetCounter('giftwrap_events_deduped')
      return
    }

    // 3. Skip duplicate TLS PendingTransfers.
    const existing = await this.transferStore.listByTxId(msg.eventId)
    if (existing.length > 0) {
      console.log('[NostrIncomingWatcher] Already in transfers:', msg.eventId.substring(0, 8))
      incrementNetCounter('giftwrap_events_deduped')
      return
    }

    // Ordering contract: mark processed only immediately before/after each branch's durable
    // action (review enqueue / transfer creation). Marking in bulk before parsing would mean a
    // crash between the mark and the enqueue makes replay hit dedup and the token is lost forever.
    // The wider watcher↔recovery concurrency window from deferred marking is accepted — enqueue is
    // PK-idempotent, and the transfer path is kept just as narrow by marking right before the branch.
    const markProcessed = (result: 'pending' | 'skipped') =>
      this.processedStore.save({
        externalId: msg.eventId,
        processedAt: Date.now(),
        result,
      })

    // 4. Parse the five message formats.
    const candidate = parseGiftWrapTokenContent(msg.content, msg.eventId, {
      pendingRequestId: this.getPendingRequestId(),
    })
    if (!candidate) {
      console.log('[NostrIncomingWatcher] Not a token payload, skipping:', msg.eventId.substring(0, 8))
      await markProcessed('skipped')
      return
    }

    const parsed = this.materializeCandidate(candidate)
    if (!parsed) {
      await markProcessed('skipped')
      return
    }

    // 5. Check mint trust.
    let info: { mint: string; amount: import('@/core/domain/amount').Amount; memo?: string }
    try {
      info = this.tokenCodec.inspectCashuToken(parsed.token)
    } catch (error) {
      // Undecodable token — a permanent defect, so mark it terminal (retry is pointless).
      console.warn('[NostrIncomingWatcher] Failed to inspect token:', error)
      await markProcessed('skipped')
      return
    }

    const trusted = await this.trustedMintProvider.hasTrustedMint(info.mint)
    if (!trusted) {
      // Untrusted: enqueue to the review queue and await user confirmation (no transfer created).
      // Mark only after the durable enqueue completes — if it dies in between it stays unmarked, so
      // replay re-enqueues (idempotent).
      await this.incomingReviewQueue.enqueue({
        externalId: msg.eventId,
        token: {
          type: 'cashu-token',
          token: parsed.token,
          amount: info.amount,
          mintUrl: info.mint,
          memo: parsed.memo,
        },
        queuedAt: Date.now(),
        requestId: parsed.requestId,
        senderPubkey: msg.sender,
        txId: parsed.txId,
        source: 'gift-wrap',
      })
      await markProcessed('pending')
      return
    }

    // Narrow the concurrency window with recovery: mark right before transfer creation.
    await markProcessed('pending')

    // 6. Trusted: create the PendingTransfer (direction: incoming).
    const transfer = createPendingTransfer({
      id: crypto.randomUUID(),
      txId: msg.eventId, // eventId serves as a temporary txId, linked to a Transaction later
      direction: 'incoming',
      finality: 'deferred',
      onExpiry: 'expire',
      amount: toNumber(info.amount),
      transportRef: {
        type: 'nostr-giftwrap',
        protocol: 'ecash',
        eventId: msg.eventId,
        sender: msg.sender,
        content: msg.content,
        token: parsed.token,
        mintUrl: info.mint,
        memo: parsed.memo,
        requestId: parsed.requestId,
        txId: parsed.txId,
      },
      now: Date.now(),
    })

    // 7. Persist.
    await this.transferStore.create(transfer)

    // 8. Notify the UI → TLS auto-redeems.
    this.eventBus.emit({
      type: 'incoming:received',
      payload: { transfer },
    })
  }

  private materializeCandidate(candidate: GiftWrapTokenCandidate): {
    token: string
    txId: string
    requestId?: string
    memo?: string
  } | null {
    if (candidate.kind === 'encoded-token') {
      return {
        token: candidate.token,
        txId: candidate.txId,
        requestId: candidate.requestId,
        memo: candidate.memo,
      }
    }

    try {
      return {
        token: this.tokenCodec.encodeCashuToken({
          mint: candidate.mint,
          unit: candidate.unit,
          proofs: candidate.proofs,
          memo: candidate.memo,
        }),
        txId: candidate.txId,
        requestId: candidate.requestId,
        memo: candidate.memo,
      }
    } catch (err) {
      console.warn('[NostrIncomingWatcher] Failed to encode Cashu JSON token:', err)
      return null
    }
  }
}
