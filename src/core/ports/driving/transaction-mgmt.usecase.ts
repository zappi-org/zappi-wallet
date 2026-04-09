import type { Transaction } from '@/core/domain/transaction'

export interface ProofStateResult {
  allSpent: boolean
  allPending: boolean
  states: Array<{ secret: string; state: 'unspent' | 'pending' | 'spent' }>
}

export interface ReclaimResult {
  success: boolean
  amount?: number
  alreadySpent?: boolean
}

export interface TransactionMgmtUseCase {
  getById(id: string): Promise<Transaction | null>
  list(filter?: { limit?: number; offset?: number }): Promise<Transaction[]>
  update(id: string, data: Partial<Transaction>): Promise<void>
  delete(id: string): Promise<void>
  create(tx: Transaction): Promise<void>

  /** Reclaim an unclaimed send token (handles both operationId and legacy token paths) */
  reclaimSendToken(
    txId: string,
    operationId?: string,
    token?: string,
  ): Promise<ReclaimResult>

  /** Mark a send as finalized (recipient claimed the token) */
  finalizeSend(txId: string, operationId?: string): Promise<void>

  /** Check proof states for a token (spent/pending/unspent) */
  checkProofStates(token: string): Promise<ProofStateResult>
}
