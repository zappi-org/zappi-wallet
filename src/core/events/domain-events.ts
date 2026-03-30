import type { Amount } from '@/core/domain/amount'

export type DomainEvent =
  | PaymentCompletedEvent
  | PaymentFailedEvent
  | BalanceChangedEvent

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
