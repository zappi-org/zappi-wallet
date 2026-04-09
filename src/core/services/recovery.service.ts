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
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type {
  RecoveryUseCase,
  AnchorCheckResult,
  RetryResult,
  RecoveryStatus,
} from '@/core/ports/driving/recovery.usecase'
import type { SyncResult, ProcessedRecord } from '@/core/types'
import { RETRY } from '@/core/constants'
import { parseDirectToken } from '@/core/domain/direct-token'

// ─── Anchor constants ───

const ANCHOR_VALIDITY_SECONDS = 2 * 24 * 60 * 60
const ANCHOR_MESSAGE_TYPE = 'zappi-anchor'
const ANCHOR_VERSION = 1

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
  ) {}

  // ─── syncAll (orchestration) ───

  async syncAll(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult> {
    const { anchor } = await this.check(params)

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

    const result = await this.reconstructState(params)

    const retryResult = await this.retryFailedIncomings()
    if (retryResult.errors.length > 0) {
      result.errors.push(...retryResult.errors)
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

  async reconstructState(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult> {
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
      })

      for (const msg of messages) {
        if (await this.recoveryStore.isProcessed(msg.eventId)) {
          continue
        }

        try {
          const directToken = parseDirectToken(JSON.parse(msg.content))

          if (!directToken) {
            await this.markProcessed(msg.eventId, 'skipped')
            result.eventsProcessed++
            continue
          }

          const receiveResult = await this.tokenReceiver.receiveToken(directToken.token)

          if (receiveResult.ok) {
            result.tokensReceived++
            result.amountReceived += receiveResult.value.amount
            await this.markProcessed(msg.eventId, 'success', receiveResult.value.transactionId)
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
  }
}
