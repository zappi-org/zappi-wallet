import type {
  OutgoingClaimState,
  OutgoingDeliveryState,
  OutgoingEcashOperation,
} from '@/core/domain/outgoing-ecash-lifecycle'

export interface OutgoingEcashOperationStore {
  save(operation: OutgoingEcashOperation): Promise<void>
  getByTxId(txId: string): Promise<OutgoingEcashOperation | null>
  update(
    txId: string,
    patch: Partial<Pick<
      OutgoingEcashOperation,
      'delivery' | 'claim' | 'lastCheckedAt' | 'failureReason' | 'updatedAt' | 'token' | 'operationId'
    >>,
  ): Promise<void>
  listOpen(): Promise<OutgoingEcashOperation[]>
  listByClaimState(claim: OutgoingClaimState): Promise<OutgoingEcashOperation[]>
  listByDeliveryState(delivery: OutgoingDeliveryState): Promise<OutgoingEcashOperation[]>
}
