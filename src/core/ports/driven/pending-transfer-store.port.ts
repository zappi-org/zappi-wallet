import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'


export interface PendingTransferStore {
  create(transfer: PendingTransfer): Promise<void>
  get(id: string): Promise<PendingTransfer | null>
  update(id: string, changes: Partial<PendingTransfer>): Promise<void>
  delete(id: string): Promise<void>

  listByPhase(phases: TransferPhase[]): Promise<PendingTransfer[]>
  listByTxId(txId: string): Promise<PendingTransfer[]>
  listExpired(before: number): Promise<PendingTransfer[]>
  listActive(): Promise<PendingTransfer[]>
}

