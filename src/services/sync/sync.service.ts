import { SettingsRepository } from '@/data/repositories/settings.repository'
import { ProcessedEventRepository } from '@/data/repositories/processed-event.repository'
import { FailedSwapRepository } from '@/data/repositories/failed-swap.repository'
import { NostrService } from '@/services/nostr/nostr.service'
import { processGiftWrapForNutZap } from '@/services/nostr/giftwrap'
import { PaymentService } from '@/services/payment/payment.service'
import { SecurityService } from '@/services/security/security.service'
import { TIMEOUTS, NOSTR_KINDS, RETRY } from '@/core/constants'
import type { SyncAnchor, SyncResult, ProcessedEvent } from '@/core/types'

/**
 * Result of retrying failed swaps
 */
export interface RetryResult {
  succeeded: number
  failed: number
  errors: string[]
}

/**
 * Sync status
 */
export interface SyncStatus {
  hasAnchor: boolean
  lastSyncAt?: number
  pendingRetries: number
  isSyncing: boolean
}

/**
 * Service for state synchronization and recovery
 */
export class SyncService {
  private settingsRepo: SettingsRepository
  private processedEventRepo: ProcessedEventRepository
  private failedSwapRepo: FailedSwapRepository
  private nostrService: NostrService
  private paymentService: PaymentService
  private securityService: SecurityService
  private isSyncing: boolean = false

  constructor() {
    this.settingsRepo = new SettingsRepository()
    this.processedEventRepo = new ProcessedEventRepository()
    this.failedSwapRepo = new FailedSwapRepository()
    this.nostrService = new NostrService()
    this.paymentService = new PaymentService()
    this.securityService = new SecurityService()
  }

  // ===== Anchor Management =====

  /**
   * Get the current sync anchor
   */
  async getAnchor(): Promise<SyncAnchor | null> {
    return this.settingsRepo.getSyncAnchor()
  }

  /**
   * Update the sync anchor with a new timestamp
   */
  async updateAnchor(timestamp: number, eventId?: string): Promise<void> {
    const anchor: SyncAnchor = {
      timestamp,
      eventId,
      updatedAt: Date.now(),
    }
    await this.settingsRepo.saveSyncAnchor(anchor)
  }

  /**
   * Get the timestamp to start recovery from
   * Returns anchor timestamp minus 2 days buffer, or 0 if no anchor
   */
  async getRecoveryTimestamp(): Promise<number> {
    const anchor = await this.getAnchor()
    if (!anchor) {
      return 0
    }

    // Subtract 2 days as recovery buffer
    const bufferSeconds = TIMEOUTS.RECOVERY_BUFFER_SECONDS
    return Math.max(0, anchor.timestamp - bufferSeconds)
  }

  // ===== Event Processing =====

  /**
   * Check if an event has already been processed
   */
  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEventRepo.isProcessed(eventId)
  }

  /**
   * Mark an event as processed
   */
  async markEventProcessed(
    eventId: string,
    result: ProcessedEvent['result'],
    txId?: string,
    error?: string
  ): Promise<void> {
    const processedEvent: ProcessedEvent = {
      eventId,
      txId,
      processedAt: Date.now(),
      result,
      error,
    }
    await this.processedEventRepo.markProcessed(processedEvent)
  }

  // ===== State Reconstruction =====

  /**
   * Reconstruct state by fetching and processing missed events
   */
  async reconstructState(relays: string[]): Promise<SyncResult> {
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
      // Get private key for decryption
      const keys = this.securityService.getCachedKeys()
      if (!keys) {
        result.errors.push('Wallet not unlocked - cannot decrypt events')
        return result
      }

      // Get recovery timestamp
      const since = await this.getRecoveryTimestamp()

      // Query for NIP-17 gift wrap events (kind 1059)
      const events = await this.nostrService.queryEvents(relays, {
        kinds: [NOSTR_KINDS.GIFT_WRAP],
        since,
      })

      // Process each event
      for (const event of events) {
        // Skip if already processed
        if (await this.isEventProcessed(event.id)) {
          continue
        }

        try {
          // Decrypt gift wrap and extract NutZap
          const nutzap = processGiftWrapForNutZap(event, keys.privateKey)

          if (!nutzap) {
            // Not a NutZap or failed to decrypt - mark as processed anyway
            await this.markEventProcessed(event.id, 'skipped')
            result.eventsProcessed++
            continue
          }

          // Try to receive the token
          const receiveResult = await this.paymentService.receiveEcash(nutzap.token)

          if (receiveResult.isOk()) {
            // Success!
            const { amount, transactionId } = receiveResult.value
            result.tokensReceived++
            result.amountReceived += amount
            await this.markEventProcessed(event.id, 'success', transactionId)
          } else {
            // Failed - check if retryable
            const error = receiveResult.error
            const isRetryable = 'isRetryable' in error && error.isRetryable

            if (isRetryable) {
              // Add to failed swaps queue for retry
              const errorCode = 'code' in error ? String(error.code) : 'UNKNOWN'
              await this.failedSwapRepo.save({
                id: `swap-${event.id}`,
                nostrEventId: event.id,
                token: nutzap.token,
                mintUrl: nutzap.mintUrl ?? '',
                amount: nutzap.amount ?? 0,
                error: String(error),
                errorCode,
                isRetryable: true,
                attemptCount: 1,
                lastAttemptAt: Date.now(),
                createdAt: Date.now(),
              })
              result.failedSwaps++
              await this.markEventProcessed(event.id, 'failed', undefined, String(error))
            } else {
              // Not retryable - mark as failed
              await this.markEventProcessed(event.id, 'failed', undefined, String(error))
            }
          }

          result.eventsProcessed++
        } catch (error) {
          result.errors.push(`Failed to process event ${event.id}: ${error}`)
          await this.markEventProcessed(event.id, 'failed', undefined, String(error))
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

  // ===== Failed Swap Retry =====

  /**
   * Retry all failed swaps that are retryable
   */
  async retryFailedSwaps(): Promise<RetryResult> {
    const result: RetryResult = {
      succeeded: 0,
      failed: 0,
      errors: [],
    }

    const swaps = await this.failedSwapRepo.getRetryable()

    for (const swap of swaps) {
      // Exponential backoff: skip if not enough time has passed since last attempt
      if (swap.lastAttemptAt && swap.attemptCount > 0) {
        const delay = Math.min(
          RETRY.INITIAL_DELAY * Math.pow(RETRY.BACKOFF_MULTIPLIER, swap.attemptCount - 1),
          RETRY.MAX_DELAY
        )
        if (Date.now() - swap.lastAttemptAt < delay) {
          continue // Not yet time to retry
        }
      }

      // Max attempts reached — mark as non-retryable
      if (swap.attemptCount >= RETRY.MAX_ATTEMPTS) {
        await this.failedSwapRepo.markAsNonRetryable(swap.id)
        result.failed++
        result.errors.push(`Swap ${swap.id}: max attempts reached`)
        continue
      }

      try {
        const receiveResult = await this.paymentService.receiveEcash(swap.token)

        if (receiveResult.isOk()) {
          // Success - delete from failed swaps
          await this.failedSwapRepo.delete(swap.id)
          result.succeeded++
        } else {
          // Failed again
          const error = receiveResult.error as { isRetryable?: boolean; code?: string }

          if (!error.isRetryable) {
            await this.failedSwapRepo.update(swap.id, {
              isRetryable: false,
              error: error.code || 'Unknown error',
              attemptCount: swap.attemptCount + 1,
              lastAttemptAt: Date.now(),
            })
          } else {
            await this.failedSwapRepo.update(swap.id, {
              attemptCount: swap.attemptCount + 1,
              lastAttemptAt: Date.now(),
            })
          }

          result.failed++
          result.errors.push(`Swap ${swap.id}: ${error.code || 'Unknown error'}`)
        }
      } catch (error) {
        result.failed++
        result.errors.push(`Swap ${swap.id}: ${error}`)
      }
    }

    return result
  }

  /**
   * Get all failed swaps
   */
  async getFailedSwaps() {
    return this.failedSwapRepo.findAll()
  }

  /**
   * Clean up old non-retryable failed swaps
   */
  async cleanupOldData(): Promise<void> {
    await this.failedSwapRepo.cleanupNonRetryable(30)
  }

  // ===== Status =====

  /**
   * Get current sync status
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const anchor = await this.getAnchor()
    const pendingSwaps = await this.failedSwapRepo.getRetryable()

    return {
      hasAnchor: anchor !== null,
      lastSyncAt: anchor?.updatedAt,
      pendingRetries: pendingSwaps.length,
      isSyncing: this.isSyncing,
    }
  }
}
