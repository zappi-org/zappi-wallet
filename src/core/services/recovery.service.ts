/**
 * RecoveryService — RecoveryUseCase 구현 (ZAP-140)
 *
 * Anchor 관리 + 놓친 토큰 복구 + 실패 swap 재시도를 하나로 통합.
 * 나중에 module.recover(since) 패턴으로 프로토콜 무관하게 확장 가능.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { AnchorStore, AnchorData } from '@/core/ports/driven/anchor.port'
import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { GiftwrapCursorStore } from '@/core/ports/driven/giftwrap-cursor-store.port'
import {
  giftwrapCursorKey,
  shouldDeepResync,
  sinceForDeepResync,
} from '@/core/domain/giftwrap-cursor'
import type {
  RecoveryUseCase,
  AnchorCheckResult,
  RetryResult,
  RecoveryStatus,
} from '@/core/ports/driving/recovery.usecase'
import type { FailedIncoming, SyncResult, ProcessedRecord } from '@/core/types'
import { RETRY } from '@/core/constants'
import { amount as createAmount } from '@/core/domain/amount'
import {
  candidateAmount,
  candidateMintUrl,
  parseGiftWrapTokenContent,
  type GiftWrapTokenCandidate,
} from '@/core/domain/gift-wrap-token'

// ─── Anchor constants ───

const ANCHOR_VALIDITY_SECONDS = 2 * 24 * 60 * 60
/** full/deep 창 fetch의 querySync 대기 상한 — 기본 5초로는 백로그 드레인 불가 (리뷰 #3) */
const DEEP_FETCH_MAX_WAIT_MS = 30_000
const ANCHOR_MESSAGE_TYPE = 'zappi-anchor'
const ANCHOR_VERSION = 1
type ReceiveRequestSettlement = Pick<ReceiveRequestUseCase, 'settleByPaymentRef'>

interface AnchorMessage {
  type: typeof ANCHOR_MESSAGE_TYPE
  v: typeof ANCHOR_VERSION
  timestamp: number
}

function isAnchorValid(timestamp: number): boolean {
  const now = Date.now()
  const anchorTime = timestamp * 1000
  return (now - anchorTime) < ANCHOR_VALIDITY_SECONDS * 1000
}

// ─── Service ───

export class RecoveryService implements RecoveryUseCase {
  private isSyncing = false

  constructor(
    private readonly nostr: NostrGateway,
    private readonly anchorStore: AnchorStore,
    private readonly recoveryStore: RecoveryStore,
    private readonly failedIncomingStore: FailedIncomingStore,
    private readonly tokenReceiver: TokenReceiver,
    private readonly trustedMintProvider: TrustedMintProvider,
    private readonly incomingReviewQueue: IncomingReviewQueue,
    private readonly tokenCodec: TokenCodec,
    private readonly receiveRequest?: ReceiveRequestSettlement,
    private readonly processedStore?: ProcessedStore,
    private readonly txRepo?: TransactionRepository,
    /** since cursor 저장소 (설계 §10 B5). 미주입(ks.cursor) 시 deep-resync는 no-op. */
    private readonly cursorStore?: GiftwrapCursorStore,
  ) {}

  // ─── syncAll (orchestration) ───

  async syncAll(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult> {
    const { anchor, isRecoveryMode } = await this.check(params)

    if (!anchor) {
      return {
        eventsProcessed: 0,
        tokensReceived: 0,
        amountReceived: 0,
        failedIncomings: 0,
        errors: [],
        duration: 0,
      }
    }

    // 재설치(isRecoveryMode)만 전체 replay가 정당 — 평시는 cursor 창 (설계 §10 B5)
    const result = await this.reconstructState(params, { fullReplay: isRecoveryMode })

    const retryResult = await this.retryFailedIncomings()
    if (retryResult.errors.length > 0) {
      result.errors.push(...retryResult.errors)
    }

    // 지연 발행(>2일) 안전망 — unlock 시 30일 나이 검사 (설계 [F3]: PWA엔 스케줄러가 없다)
    try {
      const deep = await this.maybeDeepResync(params)
      if (deep) {
        // deep 결과를 합산해 unlock 토스트가 과소 보고하지 않게 (리뷰 #7)
        result.eventsProcessed += deep.eventsProcessed
        result.tokensReceived += deep.tokensReceived
        result.amountReceived += deep.amountReceived
        result.failedIncomings += deep.failedIncomings
        result.errors.push(...deep.errors)
      }
    } catch (error) {
      result.errors.push(`Deep resync failed: ${error}`)
    }

    return result
  }

  /**
   * 수동 "전체 재동기화" — 재설치급 full replay (설계 §10 B5 deep-resync 트리거 ①).
   * 완료 시 deep-resync 창도 리셋한다(전체가 창을 포괄하므로).
   */
  async resyncFull(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult> {
    const result = await this.reconstructState(params, { fullReplay: true })

    const retryResult = await this.retryFailedIncomings()
    if (retryResult.errors.length > 0) {
      result.errors.push(...retryResult.errors)
    }

    // deep 창 리셋은 **오류 없는 실행**에만 (리뷰 #3) — isSyncing 단락('Sync already
    // in progress')·부분 실패가 30일 안전망을 소모하지 않게 한다.
    if (this.cursorStore && result.errors.length === 0) {
      await this.cursorStore
        .markDeepResync(giftwrapCursorKey(params.publicKey), Date.now())
        .catch(() => {})
    }

    return result
  }

  /** deep-resync 창(마지막 deep-resync 이후 − Ω)으로 1회 재조회 — 바운디드 [F3] */
  private async maybeDeepResync(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult | null> {
    if (!this.cursorStore) return null

    const key = giftwrapCursorKey(params.publicKey)
    const record = await this.cursorStore.load(key)
    const now = Date.now()
    if (!shouldDeepResync(record, now)) return null

    const since = sinceForDeepResync(record)
    console.log('[Recovery] Deep resync (30d age check), since:', since)
    const result = await this.reconstructState(params, {
      sinceSecOverride: since,
      // since를 못 구하는 비정상 상태면 전체 창으로 (유실 방지 우선)
      fullReplay: since === undefined,
    })

    // 마커 전진은 **오류 없는 실행**에만 (리뷰 #3) — isSyncing 단락이나 부분
    // 실패가 30일 안전망을 조용히 소모하면 안 된다.
    if (result.errors.length === 0) {
      await this.cursorStore.markDeepResync(key, now)
    }
    return result
  }

  // ─── Anchor check ───

  private async check(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<AnchorCheckResult> {
    const localAnchor = this.anchorStore.getCachedAnchor()

    if (localAnchor) {
      if (!navigator.onLine) {
        return { anchor: localAnchor, isRecoveryMode: false }
      }

      if (!isAnchorValid(localAnchor.timestamp)) {
        const newAnchor = await this.publishAnchor(params)
        return {
          anchor: newAnchor || localAnchor,
          isRecoveryMode: false,
        }
      }

      return { anchor: localAnchor, isRecoveryMode: false }
    }

    if (!navigator.onLine) {
      return { anchor: null, isRecoveryMode: false }
    }

    const remoteAnchors = await this.fetchAnchors(params)

    if (remoteAnchors.length > 0) {
      const oldestAnchor = remoteAnchors[0]
      const newestAnchor = remoteAnchors[remoteAnchors.length - 1]

      if (!isAnchorValid(newestAnchor.timestamp)) {
        const newAnchor = await this.publishAnchor(params)
        return {
          anchor: newAnchor || newestAnchor,
          isRecoveryMode: true,
          oldestAnchor,
        }
      }

      this.anchorStore.setCachedAnchor(newestAnchor)
      return {
        anchor: newestAnchor,
        isRecoveryMode: true,
        oldestAnchor,
      }
    }

    const newAnchor = await this.publishAnchor(params)
    return { anchor: newAnchor, isRecoveryMode: false }
  }

  // ─── State reconstruction ───

  async reconstructState(
    params: {
      privateKey: string
      publicKey: string
      relays: string[]
    },
    opts?: {
      /** 재설치·수동 전체 재동기화 — since 미적용 */
      fullReplay?: boolean
      /** deep-resync 등 명시 창(초) — cursor 계산보다 우선 */
      sinceSecOverride?: number
    },
  ): Promise<SyncResult> {
    const startTime = Date.now()
    const result: SyncResult = {
      eventsProcessed: 0,
      tokensReceived: 0,
      amountReceived: 0,
      failedIncomings: 0,
      errors: [],
      duration: 0,
    }

    if (this.isSyncing) {
      result.errors.push('Sync already in progress')
      return result
    }

    this.isSyncing = true

    try {
      const messages = await this.nostr.fetchGiftWraps({
        recipientPubkey: params.publicKey,
        relays: params.relays,
        // cursor 창 적용 (설계 §10 B5) — gateway가 store 미주입(ks.cursor)이면 무시
        cursor: {
          key: giftwrapCursorKey(params.publicKey),
          fullReplay: opts?.fullReplay,
        },
        sinceSecOverride: opts?.sinceSecOverride,
        // full/deep 창은 대기 상한을 키운다 (리뷰 #3 — 5초 부분 fetch가 "완료"로 위장 방지)
        ...(opts?.fullReplay || opts?.sinceSecOverride !== undefined
          ? { maxWaitMs: DEEP_FETCH_MAX_WAIT_MS }
          : {}),
      })

      for (const msg of messages) {
        if (await this.recoveryStore.isProcessed(msg.eventId)) {
          continue
        }
        if (this.processedStore && await this.processedStore.exists(msg.eventId)) {
          await this.markProcessed(msg.eventId, 'skipped')
          result.eventsProcessed++
          continue
        }

        // 순서 계약 (설계 §6.2 / 리뷰 #3): processedStore 마킹은 분기의 durable
        // 조치 이후(untrusted: enqueue 후) 또는 직전(trusted: receiveToken 전)에만.
        // 과거의 파싱 전 일괄 'pending' 마킹은 크래시 시 replay dedup에 걸려
        // 토큰을 영구 유실시켰다.
        try {
          const candidate = parseGiftWrapTokenContent(msg.content, msg.eventId)
          const restoreRequestId = candidate?.requestId
          const directToken = candidate ? this.materializeCandidate(candidate) : null

          if (!directToken) {
            await this.markProcessed(msg.eventId, 'skipped')
            result.eventsProcessed++
            continue
          }

          const info = directToken.mintUrl && directToken.amount != null
            ? { mint: directToken.mintUrl, amount: createAmount(directToken.amount, 'sat'), memo: directToken.memo }
            : this.tokenCodec.inspectCashuToken(directToken.token)

          if (!(await this.trustedMintProvider.hasTrustedMint(info.mint))) {
            // durable enqueue(PK 멱등) 성공 후에만 마킹 — 사이에 죽으면 미마킹이라
            // 다음 sync가 재-enqueue한다. recoveryStore는 의도적으로 미마킹:
            // review가 해소될 때까지 이 이벤트는 종결이 아니다 (기존 시맨틱 유지).
            await this.incomingReviewQueue.enqueue({
              externalId: msg.eventId,
              token: {
                type: 'cashu-token',
                token: directToken.token,
                amount: info.amount,
                mintUrl: info.mint,
                memo: directToken.memo,
              },
              queuedAt: Date.now(),
              senderPubkey: msg.sender,
              source: 'recovery',
            })
            if (this.processedStore) {
              await this.processedStore.save({
                externalId: msg.eventId,
                processedAt: Date.now(),
                result: 'pending',
              })
            }
            result.eventsProcessed++
            continue
          }

          // watcher와의 동시 처리 창 축소: 수령 시도 직전 마킹 (기존 선마킹과 동일 효과)
          if (this.processedStore) {
            await this.processedStore.save({
              externalId: msg.eventId,
              processedAt: Date.now(),
              result: 'pending',
            })
          }

          const receiveResult = await this.tokenReceiver.receiveToken(directToken.token)

          if (receiveResult.ok) {
            result.tokensReceived++
            result.amountReceived += receiveResult.value.amount
            await this.markProcessed(msg.eventId, 'success', receiveResult.value.transactionId)

            if (restoreRequestId) {
              if (this.receiveRequest) {
                this.receiveRequest.settleByPaymentRef(restoreRequestId, 'ecash')
                  .catch((err) => console.error('[Recovery] settleByPaymentRef failed:', err))
              }
              if (this.txRepo) {
                this.txRepo.update(receiveResult.value.transactionId, { intent: 'request-fulfill' })
                  .catch((err) => console.error('[Recovery] intent update failed:', err))
              }
            }
          } else {
            const { error } = receiveResult

            if (error.isRetryable) {
              await this.failedIncomingStore.save({
                id: `fi-${msg.eventId}`,
                externalId: msg.eventId,
                payload: directToken.token,
                accountId: directToken.mintUrl ?? '',
                amount: directToken.amount ?? 0,
                error: error.message,
                errorCode: error.code,
                isRetryable: true,
                attemptCount: 1,
                lastAttemptAt: Date.now(),
                createdAt: Date.now(),
              })
              result.failedIncomings++
            }

            await this.markProcessed(msg.eventId, 'failed', undefined, error.message)
          }

          result.eventsProcessed++
        } catch (error) {
          result.errors.push(`Failed to process event ${msg.eventId}: ${error}`)
          await this.markProcessed(msg.eventId, 'failed', undefined, String(error))
        }
      }

      const now = Math.floor(Date.now() / 1000)
      await this.recoveryStore.saveAnchor({ timestamp: now, updatedAt: Date.now() })
    } finally {
      this.isSyncing = false
      result.duration = Date.now() - startTime
    }

    return result
  }

  private materializeCandidate(candidate: GiftWrapTokenCandidate): {
    token: string
    memo?: string
    mintUrl?: string
    amount?: number
  } | null {
    if (candidate.kind === 'encoded-token') {
      return {
        token: candidate.token,
        memo: candidate.memo,
        mintUrl: candidate.mintUrl,
        amount: candidate.amount,
      }
    }

    try {
      const token = this.tokenCodec.encodeCashuToken({
        mint: candidate.mint,
        unit: candidate.unit,
        proofs: candidate.proofs,
        memo: candidate.memo,
      })
      return {
        token,
        memo: candidate.memo,
        mintUrl: candidateMintUrl(candidate),
        amount: candidateAmount(candidate),
      }
    } catch {
      return null
    }
  }

  // ─── Failed swap retry ───

  async retryFailedIncomings(): Promise<RetryResult> {
    const result: RetryResult = { succeeded: 0, failed: 0, errors: [] }
    const items = await this.failedIncomingStore.getRetryable()

    for (const item of items) {
      if (item.lastAttemptAt && item.attemptCount > 0) {
        const delay = Math.min(
          RETRY.INITIAL_DELAY * Math.pow(RETRY.BACKOFF_MULTIPLIER, item.attemptCount - 1),
          RETRY.MAX_DELAY,
        )
        if (Date.now() - item.lastAttemptAt < delay) continue
      }

      if (item.attemptCount >= RETRY.MAX_ATTEMPTS) {
        await this.failedIncomingStore.markAsNonRetryable(item.id)
        result.failed++
        result.errors.push(`Item ${item.id}: max attempts reached`)
        continue
      }

      try {
        if (item.redeemSucceeded) {
          await this.retryReceiveRequestSettlement(item, result)
          continue
        }

        const receiveResult = await this.tokenReceiver.receiveToken(item.payload)

        if (receiveResult.ok) {
          await this.failedIncomingStore.delete(item.id)
          result.succeeded++
        } else {
          const { error } = receiveResult

          await this.failedIncomingStore.update(item.id, {
            isRetryable: error.isRetryable,
            error: error.message,
            errorCode: error.code,
            attemptCount: item.attemptCount + 1,
            lastAttemptAt: Date.now(),
          })

          result.failed++
          result.errors.push(`Item ${item.id}: ${error.code}`)
        }
      } catch (error) {
        result.failed++
        result.errors.push(`Item ${item.id}: ${error}`)
      }
    }

    return result
  }

  private async retryReceiveRequestSettlement(
    item: FailedIncoming,
    result: RetryResult,
  ): Promise<void> {
    if (!this.receiveRequest || !item.receiveRequestPaymentRef || !item.receiveRequestMethod) {
      const error = 'Missing ReceiveRequest settlement retry context'
      await this.failedIncomingStore.update(item.id, {
        isRetryable: false,
        error,
        errorCode: 'RECEIVE_REQUEST_SETTLEMENT_CONTEXT_MISSING',
        attemptCount: item.attemptCount + 1,
        lastAttemptAt: Date.now(),
      })
      result.failed++
      result.errors.push(`Item ${item.id}: RECEIVE_REQUEST_SETTLEMENT_CONTEXT_MISSING`)
      return
    }

    try {
      await this.receiveRequest.settleByPaymentRef(
        item.receiveRequestPaymentRef,
        item.receiveRequestMethod,
      )
      await this.failedIncomingStore.delete(item.id)
      result.succeeded++
    } catch (error) {
      await this.failedIncomingStore.update(item.id, {
        isRetryable: true,
        error: String(error),
        errorCode: 'RECEIVE_REQUEST_SETTLEMENT_FAILED',
        attemptCount: item.attemptCount + 1,
        lastAttemptAt: Date.now(),
      })
      result.failed++
      result.errors.push(`Item ${item.id}: RECEIVE_REQUEST_SETTLEMENT_FAILED`)
    }
  }

  // ─── Queries ───

  async getFailedIncomings() {
    return this.failedIncomingStore.findAll()
  }

  async getSyncStatus(): Promise<RecoveryStatus> {
    const anchor = await this.recoveryStore.getAnchor()
    const pendingItems = await this.failedIncomingStore.getRetryable()

    return {
      hasAnchor: anchor !== null,
      lastSyncAt: anchor?.updatedAt,
      pendingRetries: pendingItems.length,
      isSyncing: this.isSyncing,
    }
  }

  async cleanupOldData(): Promise<void> {
    await this.failedIncomingStore.cleanupNonRetryable(30)
  }

  // ─── Private: anchor ───

  private async publishAnchor(params: {
    publicKey: string
    relays: string[]
  }): Promise<AnchorData | null> {
    try {
      const now = Math.floor(Date.now() / 1000)
      const message: AnchorMessage = {
        type: ANCHOR_MESSAGE_TYPE,
        v: ANCHOR_VERSION,
        timestamp: now,
      }

      const event = await this.nostr.sendGiftWrap({
        recipientPubkey: params.publicKey,
        content: JSON.stringify(message),
        relays: params.relays,
      })

      const anchor: AnchorData = {
        timestamp: now,
        eventId: event.id,
        cachedAt: Date.now(),
      }

      this.anchorStore.setCachedAnchor(anchor)
      return anchor
    } catch (error) {
      console.error('[RecoveryService] Failed to publish anchor:', error)
      return null
    }
  }

  private async fetchAnchors(params: {
    publicKey: string
    relays: string[]
  }): Promise<AnchorData[]> {
    try {
      const messages = await this.nostr.fetchGiftWraps({
        recipientPubkey: params.publicKey,
        relays: params.relays,
      })

      const anchors: AnchorData[] = []
      for (const msg of messages) {
        try {
          const content = JSON.parse(msg.content)
          if (content.type === ANCHOR_MESSAGE_TYPE && content.v === ANCHOR_VERSION) {
            anchors.push({
              timestamp: content.timestamp,
              eventId: msg.eventId,
              cachedAt: Date.now(),
            })
          }
        } catch {
          // Not valid JSON or not an anchor
        }
      }

      anchors.sort((a, b) => a.timestamp - b.timestamp)
      return anchors
    } catch (error) {
      console.error('[RecoveryService] Failed to fetch anchors:', error)
      return []
    }
  }

  // ─── Private: event processing ───

  private async markProcessed(
    externalId: string,
    result: ProcessedRecord['result'],
    txId?: string,
    error?: string,
  ): Promise<void> {
    await this.recoveryStore.markProcessed({
      externalId,
      txId,
      processedAt: Date.now(),
      result,
      error,
    })
    if (this.processedStore) {
      await this.processedStore.save({
        externalId,
        txId,
        processedAt: Date.now(),
        result,
        error,
      })
    }
  }
}
