import type { Amount } from '@/core/domain/amount'
import type { PendingTransfer } from '@/core/domain/pending-transfer'

export type DomainEvent =
  | PaymentCompletedEvent
  | PaymentDeferredEvent
  | PaymentFailedEvent
  | BalanceChangedEvent
  | TransactionsChangedEvent
  | SwapCompletedEvent
  | SwapFailedEvent
  | RecoveryCompletedEvent
  | ReceiveSettledEvent
  | ReceiveRequestFulfilledEvent
  | SendClaimedEvent
  | SendReclaimedEvent
  | ReceiveClaimedEvent
  // TransferLifecycle events
  | TransferSubmittedEvent
  | TransferPhaseChangedEvent
  | TransferSettledEvent
  | TransferReclaimedEvent
  | TransferFailedEvent
  | IncomingTransferProcessedEvent
  | IncomingTransferReceivedEvent
  | TransferNeedsPollingEvent

export interface PaymentCompletedEvent {
  type: 'payment:completed'
  payload: {
    txId: string
    method: string
    amount: Amount
    fee?: Amount
  }
}

export interface PaymentDeferredEvent {
  type: 'payment:deferred'
  payload: {
    txId: string
    method: string
    amount: Amount
    fee?: Amount
  }
}

export interface PaymentFailedEvent {
  type: 'payment:failed'
  payload: {
    txId: string
    method: string
    error: string
  }
}

export interface BalanceChangedEvent {
  type: 'balance:changed'
  payload: {
    moduleId: string
    accountId: string
  }
}

export interface TransactionsChangedEvent {
  type: 'transactions:changed'
  payload: {
    reason: string
    txId?: string
  }
}

export interface SwapCompletedEvent {
  type: 'swap:completed'
  payload: {
    sendTxId: string
    receiveTxId: string
    sourceAccountId: string
    targetAccountId: string
    amount: Amount
    fee: Amount
  }
}

export interface SwapFailedEvent {
  type: 'swap:failed'
  payload: {
    sourceAccountId: string
    targetAccountId: string
    error: string
  }
}

export interface RecoveryCompletedEvent {
  type: 'recovery:completed'
  payload: {
    moduleId: string
    recovered: number
    failed: number
  }
}

export interface ReceiveSettledEvent {
  type: 'receive:settled'
  payload: {
    requestId: string
    amount: number
    fee?: number
    accountId: string
    method: string
    isSwapStep: boolean
    /** True when this settlement matched a ReceiveRequest the user created — bridge skips the generic toast in that case (the dedicated receive:request-fulfilled event fires its own). */
    wasRequestFulfilled?: boolean
    metadata?: Record<string, unknown>
  }
}

/** A ReceiveRequest the user created has been fulfilled (verified by paymentRef match). */
export interface ReceiveRequestFulfilledEvent {
  type: 'receive:request-fulfilled'
  payload: {
    txId: string
    amount: Amount
    fee?: Amount
    method: string
    paymentRef: string
  }
}

/**
 * Semantic user-action events for cashu ecash flows.
 *
 * `payment:completed` is reserved for Lightning melt completion. Cashu token
 * send/reclaim/redeem emit these semantic events instead — payload is
 * self-contained (amount, memo, protocol) so subscribers don't re-query.
 */

/** A send I initiated was claimed/consumed by the counterparty. */
export interface SendClaimedEvent {
  type: 'send:claimed'
  payload: {
    txId: string
    method: string
    protocol: string
    amount: Amount
    memo?: string
  }
}

/** A pending send I initiated was reclaimed back to my wallet. */
export interface SendReclaimedEvent {
  type: 'send:reclaimed'
  payload: {
    txId: string
    method: string
    protocol: string
    amount: Amount
  }
}

/** I received a token (ecash redeem / incoming settlement). */
export interface ReceiveClaimedEvent {
  type: 'receive:claimed'
  payload: {
    txId: string
    method: string
    protocol: string
    amount: Amount
    memo?: string
  }
}

// ─── TransferLifecycle Events ───

export interface TransferSubmittedEvent {
  type: 'transfer:submitted'
  payload: { transfer: PendingTransfer }
}

export interface TransferPhaseChangedEvent {
  type: 'transfer:phase-changed'
  payload: { transfer: PendingTransfer; previousPhase: string }
}

export interface TransferSettledEvent {
  type: 'transfer:settled'
  payload: { transfer: PendingTransfer }
}

export interface TransferReclaimedEvent {
  type: 'transfer:reclaimed'
  payload: { transfer: PendingTransfer }
}

export interface TransferFailedEvent {
  type: 'transfer:failed'
  payload: { transfer: PendingTransfer; reason: string }
}

export interface IncomingTransferProcessedEvent {
  type: 'incoming:processed'
  payload: { transfer: PendingTransfer }
}

export interface IncomingTransferReceivedEvent {
  type: 'incoming:received'
  payload: { transfer: PendingTransfer }
}

export interface TransferNeedsPollingEvent {
  type: 'transfer:needs-polling'
  payload: { transfer: PendingTransfer }
}
