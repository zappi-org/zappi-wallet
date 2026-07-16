/**
 * RecoverySchedulerService — runs recoverAll broken into behavior units.
 *
 * All behaviors are injected as functions (DI) — this service knows nothing of
 * module implementations and owns only "what fires when" (gating, composition,
 * reporting). Coco/module wiring is done by bootstrap.
 */

import { toNumber, type Amount } from '@/core/domain/amount'
import { RequestGate } from '@/core/utils/request-gate'
import type {
  ReconcileReport,
  RecoverySchedulerUseCase,
} from '@/core/ports/driving/recovery-scheduler.usecase'
import type { RecoveryReport } from '@/core/ports/driving/payment.usecase'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { PendingIncomingReview } from '@/core/types'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface RecoverySchedulerDeps {
  /** Local reconciliation (no network). */
  reconcileCashu(): Promise<ReconcileReport>
  /** Re-run stuck PAID quotes that Coco is tracking. */
  requeuePaidQuotes(): Promise<{ requeued: string[] }>
  /** Redeem offline-received tokens. */
  redeemOfflineTokens(): Promise<{ redeemed: number; failed: number }>
  /** Self-receive legacy (no operationId) send tokens. */
  recoverLegacySends(): Promise<{ reclaimed: number; recorded: number }>
  /** All Coco recovery sweeps (skipped if inProgress) — full only. */
  runCocoSweeps(): Promise<{ ran: string[]; skipped: string[] }>
  /** Source queue for drain. */
  reviewQueue: IncomingReviewQueue
  /** Drain redeem — a narrowed surface of payment.redeem. */
  redeemToken(input: string): Promise<Result<{ amount: Amount }, BaseError>>
  /** Drain-success post-processing — mark processedStore success, complete the linked request, remove from queue, ACK. */
  resolveReview(review: PendingIncomingReview): Promise<void>
  /** Drain permanent-failure post-processing — mark processedStore skipped, remove from queue. */
  discardReview(review: PendingIncomingReview, reason: string): Promise<void>
}

/**
 * Failures where drain may close the queue — only when the token itself is
 * spent/invalid. Same policy as offline-token-recovery. We don't use all of
 * isRetryable=false because a non-retryable error caused by the environment
 * (e.g. UNTRUSTED_MINT), where the token is fine, would discard a review before
 * the user decides — a funds loss.
 */
const PERMANENT_TOKEN_ERROR_CODES = new Set(['TOKEN_SPENT', 'INVALID_TOKEN', 'INVALID_PROOF'])

export class RecoverySchedulerService implements RecoverySchedulerUseCase {
  /** Absorb high-frequency triggers (e.g. the Token tab). */
  private readonly reconcileGate = new RequestGate({ cooldownMs: 10_000, failureCooldownMs: 10_000 })
  /** Cap on network-recovery frequency. */
  private readonly targetedGate = new RequestGate({ cooldownMs: 5 * 60_000, failureCooldownMs: 30_000 })
  /** Full has no gate (explicit user intent) — rapid repeats only share the in-flight call. */
  private readonly fullGate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 0 })

  constructor(private readonly deps: RecoverySchedulerDeps) {}

  async reconcile(): Promise<ReconcileReport> {
    const { value } = await this.reconcileGate.run('reconcile', () => this.deps.reconcileCashu())
    return value
  }

  async recoverTargeted(opts?: { bypassGate?: boolean }): Promise<RecoveryReport> {
    if (opts?.bypassGate) {
      return this.runTargeted()
    }
    const { value } = await this.targetedGate.run('recovery:targeted', () => this.runTargeted())
    return value
  }

  async drainReviewQueue(mintUrl: string): Promise<{ redeemed: number; amount: number }> {
    const reviews = await this.deps.reviewQueue.listByMint(mintUrl)
    let redeemed = 0
    let amount = 0

    for (const review of reviews) {
      try {
        const result = await this.deps.redeemToken(review.token.token)
        if (result.ok) {
          redeemed++
          amount += toNumber(result.value.amount)
          await this.deps.resolveReview(review)
        } else if (PERMANENT_TOKEN_ERROR_CODES.has(result.error.code)) {
          // Token already spent/invalid — retry is pointless, close the queue.
          await this.deps.discardReview(review, result.error.message)
        }
        // Otherwise (transient or environmental): leave in queue — the next drain or the user-confirm modal retries.
      } catch (error) {
        console.error('[RecoveryScheduler] drain redeem failed:', review.externalId, error)
      }
    }

    return { redeemed, amount }
  }

  async runFullNetworkRecovery(): Promise<RecoveryReport> {
    const { value } = await this.fullGate.run('recovery:full', async () => {
      // Coco sweeps (receive/mint) — skipped individually if inProgress.
      const sweeps = await this.deps.runCocoSweeps()
      console.log(`[RecoveryScheduler] Coco sweeps ran=[${sweeps.ran}] skipped=[${sweeps.skipped}]`)

      // Targeted recovery, gate-bypassed — run directly only here to avoid duplication.
      const targeted = await this.runTargeted()

      // Finalize local reconciliation, gate-bypassed — reflect full's results into the tx DB immediately.
      const rec = await this.deps.reconcileCashu()

      return {
        moduleId: targeted.moduleId,
        recovered: targeted.recovered + rec.settled + rec.reclaimed,
        failed: targeted.failed + rec.failed,
      } satisfies RecoveryReport
    })
    return value
  }

  /** Actual execution without a gate — recoverTargeted and full wrap it. */
  private async runTargeted(): Promise<RecoveryReport> {
    const [requeue, offline, legacy] = await Promise.allSettled([
      this.deps.requeuePaidQuotes(),
      this.deps.redeemOfflineTokens(),
      this.deps.recoverLegacySends(),
    ])

    const requeued = requeue.status === 'fulfilled' ? requeue.value.requeued.length : 0
    const off = offline.status === 'fulfilled' ? offline.value : { redeemed: 0, failed: 1 }
    const leg = legacy.status === 'fulfilled' ? legacy.value : { reclaimed: 0, recorded: 0 }

    // Preserve the existing recoverPending counting convention: recovered = count of actual funds recovered.
    return {
      moduleId: 'cashu',
      recovered: requeued + off.redeemed + leg.reclaimed,
      failed: off.failed + (requeue.status === 'rejected' ? 1 : 0) + (legacy.status === 'rejected' ? 1 : 0),
    }
  }
}
