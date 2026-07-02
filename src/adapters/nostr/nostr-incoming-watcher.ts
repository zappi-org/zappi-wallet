/**
 * NostrIncomingWatcher — Adapter Layer
 *
 * NIP-17 gift wrap 수신 → 복호화/검증 → PendingTransfer 생성 → Store 저장
 *
 * ⚠️ 이 Watcher는 "발견"만 담당합니다.
 * 생성된 PendingTransfer는 TransferLifecycleService가 "관리"합니다.
 *
 * 복호화는 NostrGatewayAdapter 내부에서 처리됩니다.
 * 이 Watcher는 UnwrappedMessage(content, sender, eventId)를 받습니다.
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
  ) {}

  start(recipientPubkey: string): void {
    if (this.unsubscribe) return

    this.unsubscribe = this.nostrGateway.subscribeGiftWraps(
      { recipientPubkey },
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

  private async handleMessage(msg: UnwrappedMessage): Promise<void> {
    // 계측 (설계 §12): received 대비 deduped 비율이 곧 replay 낭비의 실측치 —
    // 2단계(cursor) 배포 전후 비교의 근거가 된다.
    incrementNetCounter('giftwrap_events_received')

    // 1. RecoveryService가 이미 처리한 eventId인지 확인 (복구 동기화 중복 방지)
    if (await this.recoveryStore.isProcessed(msg.eventId)) {
      console.log('[NostrIncomingWatcher] Already recovered:', msg.eventId.substring(0, 8))
      incrementNetCounter('giftwrap_events_deduped')
      return
    }

    // 2. 이미 GiftWrapWatcher/IncomingPaymentService가 처리한 eventId인지 확인
    if (await this.processedStore.exists(msg.eventId)) {
      console.log('[NostrIncomingWatcher] Already processed:', msg.eventId.substring(0, 8))
      incrementNetCounter('giftwrap_events_deduped')
      return
    }

    // 3. TLS PendingTransfer 중복 방지
    const existing = await this.transferStore.listByTxId(msg.eventId)
    if (existing.length > 0) {
      console.log('[NostrIncomingWatcher] Already in transfers:', msg.eventId.substring(0, 8))
      incrementNetCounter('giftwrap_events_deduped')
      return
    }

    // 3a. recovery와의 양방향 race 방지: 모든 중복 체크 통과 즉시 마킹
    await this.processedStore.save({
      externalId: msg.eventId,
      processedAt: Date.now(),
      result: 'pending',
    })

    // 4. 5종 메시지 포맷 파싱
    const candidate = parseGiftWrapTokenContent(msg.content, msg.eventId, {
      pendingRequestId: this.getPendingRequestId(),
    })
    if (!candidate) {
      console.log('[NostrIncomingWatcher] Not a token payload, skipping:', msg.eventId.substring(0, 8))
      return
    }

    const parsed = this.materializeCandidate(candidate)
    if (!parsed) return

    // 5. mint 신뢰도 확인
    let info: { mint: string; amount: import('@/core/domain/amount').Amount; memo?: string }
    try {
      info = this.tokenCodec.inspectCashuToken(parsed.token)
    } catch (error) {
      console.warn('[NostrIncomingWatcher] Failed to inspect token:', error)
      return
    }

    const trusted = await this.trustedMintProvider.hasTrustedMint(info.mint)
    if (!trusted) {
      // untrusted: review queue에 넣고 사용자 확인 대기 (transfer 미생성)
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
      return
    }

    // 6. trusted: PendingTransfer 생성 (direction: incoming)
    const transfer = createPendingTransfer({
      id: crypto.randomUUID(),
      txId: msg.eventId, // eventId를 임시 txId로 사용 (나중에 Transaction과 연결)
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

    // 7. 저장
    await this.transferStore.create(transfer)

    // 8. UI 알림 → TLS가 자동 redeem
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
