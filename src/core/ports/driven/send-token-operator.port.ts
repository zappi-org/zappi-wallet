export interface ProofStateResult {
  allSpent: boolean
  allPending: boolean
  states: Array<{ secret: string; state: 'unspent' | 'pending' | 'spent' }>
}

export interface SendTokenOperator {
  rollbackSendToken(operationId: string): Promise<void>
  finalizeSend(operationId: string): Promise<void>
  markSendFinalized(txId: string): Promise<void>
  markSendReclaimed(txId: string): Promise<void>
  checkProofStates(token: string): Promise<ProofStateResult>
}
