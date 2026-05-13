/**
 * GiftWrapWatcher — NIP-17 gift wrap 메시지 수신 + 토큰 처리
 *
 * 비즈니스 로직만 담당:
 *   - 5종 메시지 포맷 파싱
 *   - IncomingPaymentService로 토큰 redeem
 *   - POS delivery ACK 전송
 *   - EventBus로 UI 알림
 *
 * relay 연결/재연결은 NostrGateway가 내부적으로 처리.
 */

import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import type { IncomingPaymentUseCase } from '@/core/ports/driving/incoming-payment.usecase'
import type { EventBus } from '@/core/events/event-bus'
import type { POSDevice } from '@/core/types/wallet'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import {
  parseGiftWrapTokenContent,
  type GiftWrapTokenCandidate,
} from '@/core/domain/gift-wrap-token'

// ─── Types ───

export interface GiftWrapWatcherDeps {
  nostrGateway: NostrGateway
  incomingPayment: IncomingPaymentUseCase
  eventBus: EventBus
  recipientPubkey: string
  getRelays: () => string[]
  getPosDevices: () => POSDevice[] | undefined
  getPendingRequestId: () => string | null
  trustedMintProvider: TrustedMintProvider
  incomingReviewQueue: IncomingReviewQueue
  tokenCodec: TokenCodec
}

interface ParsedMessage {
  token: string
  txId: string
  requestId?: string
  memo?: string
  metadata?: Record<string, unknown>
}

// ─── Watcher ───

export class GiftWrapWatcher {
  private unsubscribe: (() => void) | null = null
  private deps: GiftWrapWatcherDeps

  constructor(deps: GiftWrapWatcherDeps) {
    this.deps = deps
  }

  async start(): Promise<void> {
    if (this.unsubscribe) return // guard against double start

    const relays = this.deps.getRelays()
    if (relays.length > 0) {
      await this.deps.nostrGateway.connect(relays)
    }

    this.unsubscribe = this.deps.nostrGateway.subscribeGiftWraps(
      { recipientPubkey: this.deps.recipientPubkey },
      (msg) => {
        this.handleMessage(msg).catch(err =>
          console.error('[GiftWrapWatcher] handleMessage error:', err),
        )
      },
    )

    console.log('[GiftWrapWatcher] Started')
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
      console.log('[GiftWrapWatcher] Stopped')
    }
  }

  // ─── Message handling ───

  private async handleMessage(msg: UnwrappedMessage): Promise<void> {
    console.log(`[GiftWrapWatcher] Received message (id: ${msg.eventId.substring(0, 8)}...)`)

    const parsed = await this.parseMessageContent(msg.content, msg.eventId)
    if (!parsed) return

    try {
      const info = this.deps.tokenCodec.inspectCashuToken(parsed.token)
      const trusted = await this.deps.trustedMintProvider.hasTrustedMint(info.mint)

      if (!trusted) {
        await this.deps.incomingReviewQueue.enqueue({
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
        return
      }
    } catch (error) {
      console.warn('[GiftWrapWatcher] Failed to preview token before trust check:', error)
    }

    const result = await this.deps.incomingPayment.processIncoming({
      payload: parsed.token,
      externalId: msg.eventId,
      memo: parsed.memo,
      metadata: parsed.metadata ? { sender: msg.sender, ...parsed.metadata } : { sender: msg.sender },
      receiveRequestPaymentRef: parsed.requestId,
      receiveRequestMethod: parsed.requestId ? 'ecash' : undefined,
    })

    if (result.status === 'already_processed') return

    if (result.status === 'success' && result.amount) {
      this.deps.eventBus.emit({
        type: 'receive:settled',
        payload: {
          requestId: parsed.requestId || msg.eventId,
          amount: result.amount,
          fee: result.fee,
          accountId: 'cashu:ecash',
          method: 'nostr-gift-wrap',
          isSwapStep: false,
          wasRequestFulfilled: result.requestFulfilled === true,
          metadata: parsed.metadata,
        },
      })

      this.maybeAckPOS(msg.sender, parsed.txId)
    }

    if (result.status === 'failed') {
      console.error('[GiftWrapWatcher] Token processing failed:', result.error)
    }
  }

  // ─── POS ACK ───

  private maybeAckPOS(senderPubkey: string, txId: string): void {
    const devices = this.deps.getPosDevices()
    if (!devices?.some(d => d.nostrPublicKey === senderPubkey)) return

    const relays = this.deps.nostrGateway.getRelayStatus()
      .filter(r => r.connected)
      .map(r => r.url)

    if (relays.length === 0) return

    const ackContent = JSON.stringify({ type: 'delivery_ack', txId })
    this.deps.nostrGateway.sendPrivateDirectMessage({
      recipientPubkey: senderPubkey,
      content: ackContent,
      relays,
    }).catch(err => console.warn('[GiftWrapWatcher] ACK send error:', err))
  }

  // ─── 5종 메시지 포맷 파싱 ───

  private async parseMessageContent(content: string, eventId: string): Promise<ParsedMessage | null> {
    const candidate = parseGiftWrapTokenContent(content, eventId, {
      pendingRequestId: this.deps.getPendingRequestId(),
    })
    if (!candidate) return null
    return this.materializeCandidate(candidate)
  }

  private materializeCandidate(candidate: GiftWrapTokenCandidate): ParsedMessage | null {
    if (candidate.kind === 'encoded-token') {
      return {
        token: candidate.token,
        txId: candidate.txId,
        requestId: candidate.requestId,
        memo: candidate.memo,
        metadata: candidate.metadata,
      }
    }

    try {
      return {
        token: this.deps.tokenCodec.encodeCashuToken({
          mint: candidate.mint,
          unit: candidate.unit,
          proofs: candidate.proofs,
          memo: candidate.memo,
        }),
        txId: candidate.txId,
        requestId: candidate.requestId,
        memo: candidate.memo,
        metadata: candidate.metadata,
      }
    } catch (err) {
      console.warn('[GiftWrapWatcher] Failed to encode Cashu JSON token:', err)
      return null
    }
  }

}
