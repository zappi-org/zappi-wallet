/**
 * RecoverTokenService — RecoverTokenUseCase 구현 (ZAP-161)
 *
 * 오프라인 동안 놓친 NUT-18 Direct Token을 복구.
 * NostrGateway로 gift wrap 조회 → parseDirectToken으로 파싱 → TokenReceiver로 수신.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { FailedSwapStore } from '@/core/ports/driven/failed-swap-store.port'
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type {
  RecoverTokenUseCase,
  RetryResult,
  RecoveryStatus,
} from '@/core/ports/driving/recover-token.usecase'
import type { SyncAnchor, SyncResult, ProcessedEvent } from '@/core/types'
import { RETRY } from '@/core/constants'
import { parseDirectToken } from '@/core/domain/direct-token'

export class RecoverTokenService implements RecoverTokenUseCase {
  private isSyncing = false

  constructor(
    private readonly nostr: Pick<NostrGateway, 'fetchGiftWraps'>,
    private readonly recoveryStore: RecoveryStore,
    private readonly failedSwapStore: FailedSwapStore,
    private readonly tokenReceiver: TokenReceiver,
  ) {}

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
      failedSwaps: 0,
      errors: [],
      duration: 0,
    }

    if (this.isSyncing) {
      result.errors.push('Sync already in progress')
      return result
    }

    this.isSyncing = true

    try {
      // Fetch gift wraps from relays
      const messages = await this.nostr.fetchGiftWraps({
        recipientPubkey: params.publicKey,
        relays: params.relays,
      })

      for (const msg of messages) {
        if (await this.recoveryStore.isEventProcessed(msg.eventId)) {
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
              await this.failedSwapStore.save({
                id: `swap-${msg.eventId}`,
                nostrEventId: msg.eventId,
                token: directToken.token,
                mintUrl: directToken.mintUrl ?? '',
                amount: directToken.amount ?? 0,
                error: error.message,
                errorCode: error.code,
                isRetryable: true,
                attemptCount: 1,
                lastAttemptAt: Date.now(),
                createdAt: Date.now(),
              })
              result.failedSwaps++
            }

            await this.markProcessed(msg.eventId, 'failed', undefined, error.message)
          }

          result.eventsProcessed++
        } catch (error) {
          result.errors.push(`Failed to process event ${msg.eventId}: ${error}`)
          await this.markProcessed(msg.eventId, 'failed', undefined, String(error))
        }
      }

      // Update anchor to current time
      const now = Math.floor(Date.now() / 1000)
      await this.updateAnchor(now)
    } finally {
      this.isSyncing = false
      result.duration = Date.now() - startTime
    }

    return result
  }

  // ─── Failed swap retry ───

  async retryFailedSwaps(): Promise<RetryResult> {
    const result: RetryResult = { succeeded: 0, failed: 0, errors: [] }
    const swaps = await this.failedSwapStore.getRetryable()

    for (const swap of swaps) {
      // Exponential backoff
      if (swap.lastAttemptAt && swap.attemptCount > 0) {
        const delay = Math.min(
          RETRY.INITIAL_DELAY * Math.pow(RETRY.BACKOFF_MULTIPLIER, swap.attemptCount - 1),
          RETRY.MAX_DELAY,
        )
        if (Date.now() - swap.lastAttemptAt < delay) continue
      }

      // Max attempts reached
      if (swap.attemptCount >= RETRY.MAX_ATTEMPTS) {
        await this.failedSwapStore.markAsNonRetryable(swap.id)
        result.failed++
        result.errors.push(`Swap ${swap.id}: max attempts reached`)
        continue
      }

      try {
        const receiveResult = await this.tokenReceiver.receiveToken(swap.token)

        if (receiveResult.ok) {
          await this.failedSwapStore.delete(swap.id)
          result.succeeded++
        } else {
          const { error } = receiveResult

          await this.failedSwapStore.update(swap.id, {
            isRetryable: error.isRetryable,
            error: error.message,
            errorCode: error.code,
            attemptCount: swap.attemptCount + 1,
            lastAttemptAt: Date.now(),
          })

          result.failed++
          result.errors.push(`Swap ${swap.id}: ${error.code}`)
        }
      } catch (error) {
        result.failed++
        result.errors.push(`Swap ${swap.id}: ${error}`)
      }
    }

    return result
  }

  // ─── Queries ───

  async getFailedSwaps() {
    return this.failedSwapStore.findAll()
  }

  async getSyncStatus(): Promise<RecoveryStatus> {
    const anchor = await this.recoveryStore.getAnchor()
    const pendingSwaps = await this.failedSwapStore.getRetryable()

    return {
      hasAnchor: anchor !== null,
      lastSyncAt: anchor?.updatedAt,
      pendingRetries: pendingSwaps.length,
      isSyncing: this.isSyncing,
    }
  }

  async getAnchor(): Promise<SyncAnchor | null> {
    return this.recoveryStore.getAnchor()
  }

  async updateAnchor(timestamp: number): Promise<void> {
    const anchor: SyncAnchor = {
      timestamp,
      updatedAt: Date.now(),
    }
    await this.recoveryStore.saveAnchor(anchor)
  }

  async cleanupOldData(): Promise<void> {
    await this.failedSwapStore.cleanupNonRetryable(30)
  }

  // ─── Private ───

  private async markProcessed(
    eventId: string,
    result: ProcessedEvent['result'],
    txId?: string,
    error?: string,
  ): Promise<void> {
    await this.recoveryStore.markEventProcessed({
      eventId,
      txId,
      processedAt: Date.now(),
      result,
      error,
    })
  }
}
