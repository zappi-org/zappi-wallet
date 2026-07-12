export type TransferDirection = 'outgoing' | 'incoming'

export type TransferPhase =
  | 'preparing'
  | 'submitted'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'settled'
  | 'failed'
  | 'recoverable'

export type FinalityModel =
  | 'immediate'
  | 'deferred'
  | 'revocable'

export type ExpiryAction = 'fail' | 'reclaim' | 'expire'

export interface PendingTransfer {
  readonly id: string
  readonly txId: string
  readonly direction: TransferDirection

  readonly phase: TransferPhase
  readonly finality: FinalityModel

  readonly expiresAt?: number
  readonly onExpiry: ExpiryAction

  /** Adapter reads protocol data (domain is opaque) */
  readonly transportRef: unknown

  readonly createdAt: number
  readonly updatedAt: number

  readonly amount?: number
}

export function createPendingTransfer(params: {
  id: string
  txId: string
  direction: TransferDirection
  finality: FinalityModel
  onExpiry: ExpiryAction
  expiresAt?: number
  transportRef: unknown
  now: number
  amount?: number
}): PendingTransfer {
  return {
    ...params,
    phase: 'preparing',
    createdAt: params.now,
    updatedAt: params.now,
  }
}

/**
 * Phase transition guard.
 *
 * Accepts all currently-legitimate transitions — preparing→settled (immediate
 * melt), submitted→settled (immediate finality), recoverable→settled (reclaim),
 * any movement between non-terminal phases, failed→submitted (retry). No new
 * phases introduced.
 *
 * Rejects settled → (anything but settled). settled records that funds were
 * delivered — no code path (late watcher event, duplicate confirm, recovery sweep
 * race) may revert it to unsettled/failed. settled→failed is rejected too: no
 * legitimate rollback demand exists, confirmed across all callers; the only path
 * that reached it — duplicate incoming reprocessing — is blocked by
 * processIncomingTransfer's isTerminal early return. Reversal would hide
 * double-spend/double-display bugs, so we throw rather than silently ignore.
 */
export function transitionPhase(
  transfer: PendingTransfer,
  newPhase: TransferPhase,
  now: number,
): PendingTransfer {
  if (transfer.phase === 'settled' && newPhase !== 'settled') {
    throw new Error(
      `Illegal phase transition: settled → ${newPhase} (transfer ${transfer.id})`,
    )
  }
  return { ...transfer, phase: newPhase, updatedAt: now }
}

export function isTerminal(phase: TransferPhase): boolean {
  return phase === 'settled' || phase === 'failed'
}

export function canReclaim(
  transfer: Pick<PendingTransfer, 'phase' | 'onExpiry'>,
): boolean {
  return transfer.phase === 'recoverable' && transfer.onExpiry === 'reclaim'
}

export function isExpired(transfer: PendingTransfer, now: number = Date.now()): boolean {
  return transfer.expiresAt != null && transfer.expiresAt <= now
}

/** Whether an incoming transfer is in a claimable state */
export function canComplete(
  transfer: Pick<PendingTransfer, 'phase' | 'direction'>,
): boolean {
  return transfer.direction === 'incoming' && transfer.phase === 'awaiting_confirmation'
}

