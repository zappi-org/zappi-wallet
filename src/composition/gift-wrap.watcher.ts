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
import type { ZapMessage, ZapPaymentFulfillment } from '@/core/types/zap-message'
import type { POSDevice } from '@/core/types/wallet'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import { previewCashuToken } from '@/core/domain/cashu-token-preview'

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
}

interface ParsedMessage {
  token: string
  txId: string
  requestId?: string
  memo?: string
  metadata?: Record<string, unknown>
}

// ─── Message format types ───

interface Nut18TokenMessage {
  type: 'cashu_token'
  token: string
  memo?: string
  request_id?: string
  sent_at: number
}

interface CashuV4JsonToken {
  id?: string
  mint?: string
  unit?: string
  proofs: Array<{ id: string; amount: number; secret: string; C: string }>
  txId?: string
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
      const preview = previewCashuToken(parsed.token)
      const trusted = await this.deps.trustedMintProvider.hasTrustedMint(preview.mintUrl)

      if (!trusted) {
        await this.deps.incomingReviewQueue.enqueue({
          externalId: msg.eventId,
          token: {
            type: 'cashu-token',
            token: parsed.token,
            amountSats: preview.amountSats,
            mintUrl: preview.mintUrl,
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
    // 1. Raw Cashu token (cashuA.../cashuB...)
    if (isRawCashuToken(content)) {
      const pendingRequestId = this.deps.getPendingRequestId()
      return {
        token: content.trim(),
        txId: `dm-token-${eventId.substring(0, 12)}`,
        requestId: pendingRequestId ?? undefined,
      }
    }

    // Try to parse as JSON
    let msg: unknown
    try {
      msg = JSON.parse(content)
    } catch {
      return null
    }

    // 2. NUT-18 token message
    if (isNut18TokenMessage(msg)) {
      return {
        token: msg.token,
        txId: msg.request_id || `nut18-${eventId.substring(0, 12)}`,
        requestId: msg.request_id,
        memo: msg.memo,
      }
    }

    // 3. Cashu V4 JSON token
    if (isCashuV4JsonToken(msg)) {
      const mintUrl = msg.mint || ''
      if (!mintUrl) return null

      try {
        const { getEncodedToken } = await import('@cashu/cashu-ts')
        const encodedToken = getEncodedToken({ mint: mintUrl, proofs: msg.proofs })
        return {
          token: encodedToken,
          txId: msg.txId || msg.id || `v4json-${eventId.substring(0, 12)}`,
          requestId: msg.id,
          memo: msg.memo,
          metadata: msg.metadata,
        }
      } catch (err) {
        console.warn('[GiftWrapWatcher] Failed to encode V4 token:', err)
        return null
      }
    }

    // 4 & 5. ZapMessage formats
    if (typeof msg === 'object' && msg !== null && 'type' in msg) {
      const msgType = (msg as { type: string }).type

      if (msgType === 'payment_fulfillment' && isPaymentFulfillment(msg as ZapMessage)) {
        const zapMsg = msg as ZapPaymentFulfillment
        return {
          token: zapMsg.content.token,
          txId: zapMsg.content.tx_id,
        }
      }

      // payment_request — log only, no token to process
      if (msgType === 'payment_request') {
        console.log('[GiftWrapWatcher] Received payment_request (log only)')
      }
    }

    return null
  }
}

// ─── Pure type guards ───

function isRawCashuToken(content: string): boolean {
  return /^cashu[ab]/i.test(content.trim())
}

function isNut18TokenMessage(msg: unknown): msg is Nut18TokenMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Nut18TokenMessage).type === 'cashu_token' &&
    typeof (msg as Nut18TokenMessage).token === 'string'
  )
}

function isCashuV4JsonToken(msg: unknown): msg is CashuV4JsonToken {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'proofs' in msg &&
    Array.isArray((msg as CashuV4JsonToken).proofs) &&
    (msg as CashuV4JsonToken).proofs.length > 0 &&
    typeof (msg as CashuV4JsonToken).proofs[0].C === 'string'
  )
}

function isPaymentFulfillment(msg: ZapMessage): msg is ZapPaymentFulfillment {
  return msg.type === 'payment_fulfillment'
}
