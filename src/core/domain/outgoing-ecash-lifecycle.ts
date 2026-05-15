export type OutgoingEcashOperationKind = 'token-create' | 'direct-nostr-send'

export type OutgoingDeliveryState =
  | 'not_required'
  | 'pending_publish'
  | 'published'
  | 'publish_failed'
  | 'unknown'

export type OutgoingClaimState =
  | 'unclaimed'
  | 'checking'
  | 'claim_pending'
  | 'claimed'
  | 'reclaiming'
  | 'reclaimed'
  | 'check_failed'

export type OutgoingClaimCheckResult = 'claimable' | 'pending' | 'claimed' | 'reclaimed' | 'unknown'

export type OutgoingDeliveryResult = 'published' | 'failed' | 'unknown'

export type OutgoingEcashDisplayState =
  | 'waiting_claim'
  | 'published_waiting_claim'
  | 'claimed'
  | 'reclaimed'
  | 'publish_failed'
  | 'check_failed'

export interface OutgoingEcashOperation {
  readonly txId: string
  readonly kind: OutgoingEcashOperationKind
  readonly accountId: string
  readonly amount: number
  readonly token?: string
  readonly operationId?: string
  readonly delivery: OutgoingDeliveryState
  readonly claim: OutgoingClaimState
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastCheckedAt?: number
  readonly failureReason?: string
}

export function createOutgoingEcashOperation(params: {
  txId: string
  kind: OutgoingEcashOperationKind
  accountId: string
  amount: number
  token?: string
  operationId?: string
  delivery: OutgoingDeliveryState
  now: number
}): OutgoingEcashOperation {
  return {
    txId: params.txId,
    kind: params.kind,
    accountId: params.accountId,
    amount: params.amount,
    token: params.token,
    operationId: params.operationId,
    delivery: params.delivery,
    claim: 'unclaimed',
    createdAt: params.now,
    updatedAt: params.now,
  }
}

export function applyDeliveryResult(
  operation: OutgoingEcashOperation,
  result: OutgoingDeliveryResult,
  now: number,
): OutgoingEcashOperation {
  if (operation.delivery === 'not_required') return operation

  if (result === 'published') {
    return {
      ...operation,
      delivery: 'published',
      updatedAt: now,
      failureReason: undefined,
    }
  }

  if (result === 'failed') {
    return {
      ...operation,
      delivery: 'publish_failed',
      updatedAt: now,
      failureReason: 'delivery-failed',
    }
  }

  return {
    ...operation,
    delivery: 'unknown',
    updatedAt: now,
    failureReason: 'delivery-unknown',
  }
}

export function markClaimChecking(operation: OutgoingEcashOperation, now: number): OutgoingEcashOperation {
  if (isTerminalClaim(operation.claim)) return operation
  return {
    ...operation,
    claim: 'checking',
    updatedAt: now,
    failureReason: undefined,
  }
}

export function applyClaimCheckResult(
  operation: OutgoingEcashOperation,
  result: OutgoingClaimCheckResult,
  now: number,
): OutgoingEcashOperation {
  if (operation.claim === 'reclaimed') return operation

  if (result === 'claimed') {
    return markClaimed(operation, now)
  }

  if (result === 'reclaimed') {
    return markReclaimed(operation, now)
  }

  if (result === 'claimable') {
    return {
      ...operation,
      claim: 'unclaimed',
      lastCheckedAt: now,
      updatedAt: now,
      failureReason: undefined,
    }
  }

  if (result === 'pending') {
    return {
      ...operation,
      claim: 'claim_pending',
      lastCheckedAt: now,
      updatedAt: now,
      failureReason: undefined,
    }
  }

  // Unknown is not a terminal failure. It can happen while a mint is slow,
  // a proof is transitioning, or a previous app session died mid-flight.
  // Keep the user-facing state stable and retry on the next reconciliation.
  return {
    ...operation,
    lastCheckedAt: now,
    updatedAt: now,
    failureReason: 'claim-state-unknown',
  }
}

export function markReclaiming(operation: OutgoingEcashOperation, now: number): OutgoingEcashOperation {
  if (isTerminalClaim(operation.claim)) return operation
  return {
    ...operation,
    claim: 'reclaiming',
    updatedAt: now,
    failureReason: undefined,
  }
}

export function markClaimed(operation: OutgoingEcashOperation, now: number): OutgoingEcashOperation {
  return {
    ...operation,
    claim: 'claimed',
    lastCheckedAt: now,
    updatedAt: now,
    failureReason: undefined,
  }
}

export function markReclaimed(operation: OutgoingEcashOperation, now: number): OutgoingEcashOperation {
  return {
    ...operation,
    claim: 'reclaimed',
    lastCheckedAt: now,
    updatedAt: now,
    failureReason: undefined,
  }
}

export function deriveOutgoingEcashDisplayState(
  operation: Pick<OutgoingEcashOperation, 'delivery' | 'claim'>,
): OutgoingEcashDisplayState {
  if (operation.claim === 'claimed') return 'claimed'
  if (operation.claim === 'reclaimed') return 'reclaimed'
  if (operation.delivery === 'publish_failed') return 'publish_failed'
  if (operation.claim === 'check_failed') return 'check_failed'
  if (operation.delivery === 'published') return 'published_waiting_claim'
  return 'waiting_claim'
}

export function canReclaimOutgoingEcash(
  operation: Pick<OutgoingEcashOperation, 'delivery' | 'claim'>,
): boolean {
  if (operation.claim !== 'unclaimed') return false
  return operation.delivery !== 'pending_publish'
}

export function isOpenOutgoingEcash(operation: Pick<OutgoingEcashOperation, 'claim'>): boolean {
  return !isTerminalClaim(operation.claim)
}

function isTerminalClaim(claim: OutgoingClaimState): boolean {
  return claim === 'claimed' || claim === 'reclaimed'
}
