/**
 * RecoveryScheduler — breaks recoverAll's blanket firing into per-behavior units.
 *
 * Principle: separate recovery (network) from reconciliation (local DB), and fire
 * only the actions each trigger needs. Remote settlement detection belongs to push
 * (watcher/bridge); the network actions here are limited to Zappi-specific queues
 * that push can't reach (stuck quotes, offline tokens, legacy send).
 */

import type { RecoveryReport } from './payment.usecase'

/** Local reconciliation report. */
export interface ReconcileReport {
  /** Transactions marked settled (finalized + double-net). */
  settled: number
  /** Transactions marked reclaimed (rolled back). */
  reclaimed: number
  /** Transactions marked failed (expired/removed mint, untracked, or local op failed). */
  failed: number
  /** Legacy rows cleaned up via deleteExpired. */
  cleaned: number
}

export interface RecoverySchedulerUseCase {
  /**
   * Local-only reconciliation; zero network is the contract.
   * Gated ('reconcile', 10s) for high-frequency triggers like entering the Token tab.
   */
  reconcile(): Promise<ReconcileReport>

  /**
   * Zappi-specific network recovery: requeue paid mint quotes, offline tokens, and
   * legacy send. Gated ('recovery:targeted', 5min / 30s on failure) — a re-call
   * within cooldown returns the previous report. bypassGate is only for one-shot
   * calls that must run now, e.g. right after AddMint.
   */
  recoverTargeted(opts?: { bypassGate?: boolean }): Promise<RecoveryReport>

  /**
   * Redeem the review queue when a mint is trusted. Auto-redeems pending reviews
   * for that mint — explicitly trusting a mint is the user's approval. The returned
   * amount (sat) feeds the "recovered amount" UI. Permanent failures (e.g.
   * TOKEN_SPENT) are dropped from the queue; transient errors remain.
   */
  drainReviewQueue(mintUrl: string): Promise<{ redeemed: number; amount: number }>

  /**
   * For the Settings recovery button only — no gate (explicit user intent), only
   * in-flight sharing. Runs the full Coco sweep (skipped if already in progress) +
   * targeted recovery (bypassing its gate) + reconcile. Restoring the current
   * wallet (per-mint wallet.restore) stays with recoverAccounts as a separate action.
   */
  runFullNetworkRecovery(): Promise<RecoveryReport>
}
