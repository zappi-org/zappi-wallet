/**
 * TransferLifecycleService — protocol-neutral transfer state management.
 *
 * Tracks send/receive across Bolt11/Ecash/future protocols with one state
 * machine. Delegates execution to adapters; owns only state.
 */

import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { isTerminal, isExpired, canReclaim, canComplete, transitionPhase } from '@/core/domain/pending-transfer'
import { AdapterNotFoundError } from '@/core/errors/payment.errors'
import { TransferStateError } from '@/core/errors/transfer'
import type { EventBus } from '@/core/events/event-bus'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import type { TransferIntent, TransferOperator } from '@/core/ports/driven/transfer-operator.port'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'

/** Stuck threshold — one remote check once this long has passed since the last transition. */
const STUCK_THRESHOLD_MS = 120_000

/**
 * Expiry skew margin — in the clock-skew window where the mint returns EXPIRED
 * a few seconds before the local expiresAt, prevents expiry-driven terminal
 * transitions from being miscounted as push misses.
 */
const EXPIRY_SKEW_MARGIN_MS = 30_000

export class TransferLifecycleService {
  private pollTimer: ReturnType<typeof setInterval> | null = null

  // ─── stuck-sweep state ───
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private sweepIntervalMs = 120_000
  /** True after startStuckSweep; cleared by stopStuckSweep on pause/dispose. */
  private sweepActive = false
  /** Reentrancy guard — ignore a timer re-fire while a slow sweep runs. */
  private sweepRunning = false
  /** Last sweep time — used to detect a freeze-recovery catch-up tick. */
  private lastSweepAt = 0

  constructor(
    private readonly transferStore: PendingTransferStore,
    private readonly operators: Map<string, TransferOperator>,
    private readonly eventBus: EventBus,
    private readonly operationMap?: OperationMap,
    /**
     * Counter injection — boundary so core never imports the telemetry adapter
     * directly (same reason giftwrap counters are counted at the gateway edge).
     */
    private readonly counters?: {
      stuckDetected(): void
      stuckConfirmedSettled(): void
    },
  ) { }

  async getTransfer(id: string): Promise<PendingTransfer | null> {
    return this.transferStore.get(id)
  }

  startPolling(intervalMs = 5000): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      this.pollPendingTransfers().catch((e) => {
        console.error('[TransferLifecycleService] poll error:', e)
      })
    }, intervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // ─── 120s stuck-sweep ───

  /**
   * Start the sweep: run once immediately, then on an interval. Judgment is
   * local-first; a remote check goes out only for stuck transfers (last
   * transition > 120s), once each. When nothing is pending the timer stops
   * itself and ensureSweepScheduled resumes it.
   */
  startStuckSweep(intervalMs = 120_000): void {
    this.sweepIntervalMs = intervalMs
    this.sweepActive = true
    // The immediate run right after start/resume is rescue-only (no counting):
    // just after unlock/resume it races watcher restart and Coco recovery, so
    // sweep could catch a settlement that push delivers seconds later and
    // pollute the gate counter. Real metering starts with the interval sweep,
    // which gives push time (≥1 interval) to deliver.
    void this.runStuckSweepOnce({ countStuck: false })
    this.scheduleSweepTimer()
  }

  stopStuckSweep(): void {
    this.sweepActive = false
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /**
   * Resume signal for the pending-0 self-stopped state — called by the local
   * transfer-creation path and the cross-tab 'transfer_created' notification.
   * No-op when not in sweep mode.
   */
  ensureSweepScheduled(): void {
    if (!this.sweepActive) return
    this.scheduleSweepTimer()
  }

  private scheduleSweepTimer(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => {
      // If frozen and woken with no visibilitychange (onPause never fired —
      // mobile freeze), the catch-up tick right after thaw races watcher
      // restart, so treat it as rescue-only (no counting), like the resume rule.
      const gap = Date.now() - this.lastSweepAt
      const isCatchUpAfterFreeze = this.lastSweepAt > 0 && gap > this.sweepIntervalMs * 2
      void this.runStuckSweepOnce({ countStuck: !isCatchUpAfterFreeze })
    }, this.sweepIntervalMs)
  }

  /** Public so resume/onWake can trigger a single immediate sweep. */
  async runStuckSweepOnce(opts?: { countStuck?: boolean }): Promise<void> {
    if (this.sweepRunning) return
    this.sweepRunning = true
    this.lastSweepAt = Date.now()
    const countStuck = opts?.countStuck ?? true
    try {
      const active = await this.transferStore.listActive()
      if (active.length === 0) {
        // No pending transfers → stop the timer; ensureSweepScheduled resumes it.
        // Reset lastSweepAt: the first tick after an idle resume is not a freeze
        // catch-up (prevents an idle gap > 2× interval being misread as no-count).
        this.lastSweepAt = 0
        if (this.sweepTimer) {
          clearInterval(this.sweepTimer)
          this.sweepTimer = null
        }
        return
      }

      const now = Date.now()
      for (const transfer of active) {
        try {
          await this.sweepOne(transfer, now, countStuck)
        } catch (e) {
          // Remote check failed (mint down, etc.) — retry next cycle, no transition.
          // Mapping the error to a phase would finalize an in-flight payment as
          // failed (a funds bug). Don't count it either — a failed check is not
          // evidence of a push miss.
          console.error('[TLS] sweep error:', transfer.id, e)
        }
      }
    } finally {
      this.sweepRunning = false
    }
  }

  private async sweepOne(
    transfer: PendingTransfer,
    now: number,
    countStuck: boolean,
  ): Promise<void> {
    const operator = this.findOperator(transfer)
    if (!operator) return

    // Pass 1: local judgment (no network) — reclaims local remnants that missed a
    // push. Locally-visible transitions aren't counted (no remote check needed).
    if (operator.pollLocal) {
      const localPhase = await operator.pollLocal(transfer)
      if (localPhase !== transfer.phase) {
        await this.applyPhaseTransition(transfer, localPhase)
        return
      }
    }

    // Pass 2: stuck candidates — remote-check only those past THRESHOLD since the last transition
    if (now - transfer.updatedAt <= STUCK_THRESHOLD_MS) return
    if (!operator.confirmStuck) return

    // null = this transfer type has no remote-check concept (e.g. ecash awaiting
    // manual claim). The adapter's null branch returns synchronously before the
    // await, so no network.
    const confirmed = await operator.confirmStuck(transfer)
    if (confirmed === null || confirmed === transfer.phase) return

    // Gate-counting rule: a genuine push miss = "a non-expiry transition where
    // remote was ahead of local".
    // - No phase change (UNPAID invoice waiting, unredeemed send token) already
    //   returned above — counting user waiting would make the gate (=0) always
    //   fail under normal use.
    // - Expiry-driven transitions (±skew margin) are local-clock lifetime events
    //   — not counted.
    // - No terminal-only restriction: a bolt11-receive push miss surfaces only as
    //   submitted→awaiting (non-terminal), since checkPayment returns an observed
    //   PAID before finalize. Counting terminals only would let a device with a
    //   dead receive watcher falsely pass the gate. Non-terminal counting here is
    //   exactly that PAID-observed case.
    const remoteMiss = !isExpired(transfer, now + EXPIRY_SKEW_MARGIN_MS)
    if (countStuck && remoteMiss) {
      this.counters?.stuckDetected()
      if (confirmed === 'settled') {
        this.counters?.stuckConfirmedSettled()
      }
    }
    await this.applyPhaseTransition(transfer, confirmed)
  }

  // ─── Outgoing ───

  async initiateTransfer(
    intent: TransferIntent,
    protocol: string,
  ): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new AdapterNotFoundError(`Unknown protocol: ${protocol}`)

    let transfer = await operator.prepare(intent)
    await this.transferStore.create(transfer)

    // Execute; the transfer stays in the store even on failure
    try {
      transfer = await operator.execute(transfer)
      await this.transferStore.update(transfer.id, transfer)
    } catch (error) {
      const failed = transitionPhase(
        transfer,
        'failed',
        Date.now(),
      )
      await this.transferStore.update(failed.id, failed)
      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer: failed, reason: String(error) },
      })
      return failed
    }

    this.eventBus.emit({
      type: 'transfer:submitted',
      payload: { transfer },
    })

    // Resume the sweep that self-stopped at pending-0
    this.ensureSweepScheduled()

    return transfer
  }

  // ─── Incoming ───

  async initiateIncomingTransfer(
    intent: TransferIntent,
    protocol: string,
  ): Promise<PendingTransfer> {
    const operator = this.operators.get(protocol)
    if (!operator) throw new AdapterNotFoundError(`Unknown protocol: ${protocol}`)
    if (!operator.prepareReceive) {
      throw new AdapterNotFoundError(`Protocol ${protocol} does not support incoming transfers`)
    }

    const prepared = await operator.prepareReceive(intent)

    // Register quoteId → txId so mint-quote-observer settles the same TX
    const quoteId = (prepared.transportRef as { quoteId?: string })?.quoteId
    if (quoteId && this.operationMap) {
      this.operationMap.register(quoteId, intent.txId)
    }

    // Incoming: creating the quote/invoice is itself the submission
    const transfer = transitionPhase(prepared, 'submitted', Date.now())
    await this.transferStore.create(transfer)

    this.eventBus.emit({
      type: 'transfer:submitted',
      payload: { transfer },
    })

    this.ensureSweepScheduled()

    return transfer
  }

  async processIncomingTransfer(transferId: string): Promise<void> {
    console.log('[TLS] processIncomingTransfer called:', transferId)
    const transfer = await this.transferStore.get(transferId)
    console.log('[TLS] Got transfer:', transfer?.id, 'direction:', transfer?.direction)
    if (!transfer || transfer.direction !== 'incoming') {
      console.log('[TLS] Early return: no transfer or wrong direction')
      return
    }
    // Block the path where a duplicate incoming:received re-redeems an already
    // settled transfer (→TOKEN_SPENT → catch demotes it to failed).
    if (isTerminal(transfer.phase)) {
      console.log('[TLS] Early return: transfer already terminal:', transfer.phase)
      return
    }

    const operator = this.findOperator(transfer)
    console.log('[TLS] Found operator:', operator?.protocol)
    if (!operator?.processIncoming) {
      console.log('[TLS] Early return: no operator or processIncoming')
      return
    }

    try {
      console.log('[TLS] Calling operator.processIncoming...')
      const processed = await operator.processIncoming(transfer)
      console.log('[TLS] processIncoming result phase:', processed.phase)
      await this.transferStore.update(processed.id, processed)

      this.eventBus.emit({
        type: 'incoming:processed',
        payload: { transfer: processed },
      })

      if (isTerminal(processed.phase)) {
        await this.finalizeTransfer(processed)
      }
    } catch (error) {
      console.error('[TLS] processIncomingTransfer error:', error)
      const failed = transitionPhase(transfer, 'failed', Date.now())
      await this.transferStore.update(failed.id, failed)

      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer: failed, reason: String(error) },
      })

      throw error
    }
  }

  /** Register an externally-created PendingTransfer in the store. */
  async registerTransfer(transfer: PendingTransfer): Promise<void> {
    await this.transferStore.create(transfer)
    this.ensureSweepScheduled()
  }

  /** User clicked "Receive". */
  async claimIncomingTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || transfer.direction !== 'incoming') {
      throw new TransferStateError('Not an incoming transfer')
    }
    if (!canComplete(transfer)) {
      throw new TransferStateError('Transfer is not ready to be completed')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.claimReceive) {
      throw new AdapterNotFoundError('Cannot claim this transfer')
    }

    const settled = await operator.claimReceive(transfer)
    await this.transferStore.update(settled.id, settled)

    this.eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: settled },
    })
  }

  /** Move a transfer to a terminal phase (settled/failed) from an SDK event. */
  async resolveTransfer(
    transferId: string,
    phase: 'settled' | 'failed',
  ): Promise<boolean> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || isTerminal(transfer.phase)) return false

    const previousPhase = transfer.phase
    const updated = transitionPhase(transfer, phase, Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:phase-changed',
      payload: { transfer: updated, previousPhase },
    })

    await this.finalizeTransfer(updated)
    return true
  }

  /** Find an active transfer by operationRef (quoteId/operationId) and resolve it. */
  async resolveByOperationRef(
    operationRef: string,
    phase: 'settled' | 'failed',
  ): Promise<boolean> {
    const active = await this.transferStore.listActive()
    const transfer = active.find((t) => {
      const ref = t.transportRef as Record<string, unknown>
      return ref?.quoteId === operationRef || ref?.operationId === operationRef
    })
    if (!transfer) return false
    return this.resolveTransfer(transfer.id, phase)
  }

  // ─── Polling ───

  async pollPendingTransfers(): Promise<void> {
    const pending = await this.transferStore.listActive()

    for (const transfer of pending) {
      const operator = this.findOperator(transfer)
      if (!operator) continue

      const newPhase = await operator.poll(transfer)

      if (newPhase !== transfer.phase) {
        await this.applyPhaseTransition(transfer, newPhase)
      }
    }
  }

  /** Shared by poll/sweep — persist the transition, emit phase-changed, finalize if terminal. */
  private async applyPhaseTransition(
    transfer: PendingTransfer,
    newPhase: TransferPhase,
  ): Promise<void> {
    // Close the TOCTOU window: during the poll/confirm network await, an SDK push
    // may have already settled the store — transitioning on the stale object
    // would overwrite the settlement. Re-fetch fresh so the domain guard sees the
    // real race.
    const fresh = await this.transferStore.get(transfer.id)
    if (!fresh) return // deleted by a remove-mint race, etc. — don't update a missing row
    if (fresh.phase === newPhase) return // a competitor already applied the same transition
    if (fresh.phase === 'settled' && newPhase !== 'settled') {
      // push settled first — our poll result is just stale news, not a bug
      console.warn(`[TLS] Skipping stale transition settled → ${newPhase} (${fresh.id})`)
      return
    }
    const previousPhase = fresh.phase
    const updated = transitionPhase(fresh, newPhase, Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:phase-changed',
      payload: { transfer: updated, previousPhase },
    })

    if (isTerminal(newPhase)) {
      await this.finalizeTransfer(updated)
    }
  }

  // ─── Reclaim ───

  async reclaimTransfer(transferId: string): Promise<void> {
    const transfer = await this.transferStore.get(transferId)
    if (!transfer || !canReclaim(transfer)) {
      throw new TransferStateError('Cannot reclaim this transfer')
    }

    const operator = this.findOperator(transfer)
    if (!operator?.reclaim) {
      throw new AdapterNotFoundError('Reclaim not supported for this protocol')
    }

    await operator.reclaim(transfer)

    const updated = transitionPhase(transfer, 'settled', Date.now())
    await this.transferStore.update(updated.id, updated)

    this.eventBus.emit({
      type: 'transfer:reclaimed',
      payload: { transfer: updated },
    })
  }

  // ─── Recovery (on app restart) ───

  async recoverTransfers(): Promise<void> {
    // 1. Clean up transfers stuck in 'preparing' (from an app crash)
    const stuckPreparing = await this.transferStore.listByPhase(['preparing'])
    for (const transfer of stuckPreparing) {
      if (transfer.direction === 'incoming') {
        // incoming: the quote already exists at the mint → transition to submitted
        const updated = transitionPhase(transfer, 'submitted', Date.now())
        await this.transferStore.update(updated.id, updated)
        this.eventBus.emit({
          type: 'transfer:phase-changed',
          payload: { transfer: updated, previousPhase: 'preparing' },
        })
      } else {
        // outgoing: crashed mid-execute → unknown whether it ran, so mark failed
        const failed = transitionPhase(transfer, 'failed', Date.now())
        await this.transferStore.update(failed.id, failed)
        this.eventBus.emit({
          type: 'transfer:failed',
          payload: { transfer: failed, reason: 'app-crashed-during-execution' },
        })
      }
    }

    // 2. Emit needs-polling for active transfers
    const active = await this.transferStore.listActive()
    for (const transfer of active) {
      this.eventBus.emit({
        type: 'transfer:needs-polling',
        payload: { transfer },
      })
    }
  }

  // ─── Private helpers ───

  private findOperator(transfer: PendingTransfer): TransferOperator | undefined {
    const ref = transfer.transportRef as { type?: string; protocol?: string }
    const key = ref.protocol || ref.type?.split('-')[0]
    return key ? this.operators.get(key) : undefined
  }

  private async finalizeTransfer(transfer: PendingTransfer): Promise<void> {
    if (transfer.phase === 'settled') {
      this.eventBus.emit({
        type: 'transfer:settled',
        payload: { transfer },
      })
    } else if (transfer.phase === 'failed') {
      this.eventBus.emit({
        type: 'transfer:failed',
        payload: { transfer, reason: 'terminal-failure' },
      })
    }
  }
}
