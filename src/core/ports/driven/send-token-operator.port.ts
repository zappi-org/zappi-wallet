import type { Amount } from '@/core/domain/amount'

export interface ProofStateResult {
  allSpent: boolean
  allPending: boolean
  states: Array<{ secret: string; state: 'unspent' | 'pending' | 'spent' }>
}

export interface ReclaimedTokenResult {
  amount: Amount
  fee?: Amount
  accountId: string
}

export interface SendTokenOperator {
  rollbackSendToken(operationId: string): Promise<void>
  finalizeSend(operationId: string): Promise<void>
  reclaimToken(token: string): Promise<ReclaimedTokenResult>
  checkProofStates(token: string): Promise<ProofStateResult>
}
