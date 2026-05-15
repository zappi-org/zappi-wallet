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
}): PendingTransfer {
  return {
    ...params,
    phase: 'preparing',
    createdAt: params.now,
    updatedAt: params.now,
  }
}

export function transitionPhase(
  transfer: PendingTransfer,
  newPhase: TransferPhase,
  now: number,
): PendingTransfer {
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

