import type {
  OutgoingDeliveryResult,
  OutgoingDeliveryState,
  OutgoingEcashDisplayState,
  OutgoingEcashOperation,
  OutgoingEcashOperationKind,
} from '@/core/domain/outgoing-ecash-lifecycle'

export interface OutgoingEcashStatus {
  operation: OutgoingEcashOperation
  displayState: OutgoingEcashDisplayState
  canReclaim: boolean
}

export interface OutgoingEcashLifecycleUseCase {
  recordCreated(params: {
    txId: string
    kind: OutgoingEcashOperationKind
    accountId: string
    amount: number
    token?: string
    operationId?: string
    delivery: OutgoingDeliveryState
  }): Promise<void>

  recordDeliveryResult(txId: string, result: OutgoingDeliveryResult): Promise<OutgoingEcashStatus | null>
  getStatus(txId: string): Promise<OutgoingEcashStatus | null>
  checkStatus(txId: string): Promise<OutgoingEcashStatus | null>
  reconcileOpen(): Promise<{ checked: number; claimed: number; failed: number }>
  markClaimed(txId: string): Promise<void>
  markReclaimed(txId: string): Promise<void>
}
