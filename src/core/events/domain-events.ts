import type { Amount } from '@/core/domain/amount'

export type DomainEvent =
  | PaymentCompletedEvent
  | PaymentFailedEvent
  | BalanceChangedEvent
  | SwapCompletedEvent
  | SwapFailedEvent
  | RecoveryCompletedEvent

export interface PaymentCompletedEvent {
  type: 'payment:completed'
  payload: {
    txId: string
    method: string
    amount: Amount
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
