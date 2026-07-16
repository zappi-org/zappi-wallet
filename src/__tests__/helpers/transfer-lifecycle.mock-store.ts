/**
 * InMemoryPendingTransferStore — mock store for TransferLifecycleService unit tests.
 * Used until the real DexieStore exists; to be replaced by DexiePendingTransferStore.
 */

import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'

export class InMemoryPendingTransferStore implements PendingTransferStore {
  private data = new Map<string, PendingTransfer>()

  async create(transfer: PendingTransfer): Promise<void> {
    this.data.set(transfer.id, transfer)
  }

  async get(id: string): Promise<PendingTransfer | null> {
    return this.data.get(id) ?? null
  }

  async update(id: string, changes: Partial<PendingTransfer>): Promise<void> {
    const existing = this.data.get(id)
    if (!existing) throw new Error(`Transfer not found: ${id}`)
    this.data.set(id, { ...existing, ...changes })
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id)
  }

  async listByPhase(phases: TransferPhase[]): Promise<PendingTransfer[]> {
    return [...this.data.values()].filter((t) => phases.includes(t.phase))
  }

  async listByTxId(txId: string): Promise<PendingTransfer[]> {
    return [...this.data.values()].filter((t) => t.txId === txId)
  }

  async listExpired(before: number): Promise<PendingTransfer[]> {
    return [...this.data.values()].filter(
      (t) => t.expiresAt != null && t.expiresAt <= before,
    )
  }

  /** active = submitted, in_transit, awaiting_confirmation */
  async listActive(): Promise<PendingTransfer[]> {
    return this.listByPhase(['submitted', 'in_transit', 'awaiting_confirmation'])
  }

  // Test-only helpers
  clear(): void {
    this.data.clear()
  }

  size(): number {
    return this.data.size
  }
}
