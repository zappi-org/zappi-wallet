import type {
  OutgoingClaimState,
  OutgoingDeliveryState,
  OutgoingEcashOperation,
} from '@/core/domain/outgoing-ecash-lifecycle'
import type { OutgoingEcashOperationStore } from '@/core/ports/driven/outgoing-ecash-operation-store.port'
import { getDatabase } from './schema'

export class DexieOutgoingEcashOperationStore implements OutgoingEcashOperationStore {
  private get table() {
    return getDatabase().outgoingEcashOperations
  }

  async save(operation: OutgoingEcashOperation): Promise<void> {
    await this.table.put(operation)
  }

  async getByTxId(txId: string): Promise<OutgoingEcashOperation | null> {
    return (await this.table.get(txId)) ?? null
  }

  async update(txId: string, patch: Partial<OutgoingEcashOperation>): Promise<void> {
    await this.table.update(txId, {
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
    })
  }

  async listOpen(): Promise<OutgoingEcashOperation[]> {
    const records = await this.table.toArray()
    return records.filter((record) => record.claim !== 'claimed' && record.claim !== 'reclaimed')
  }

  async listByClaimState(claim: OutgoingClaimState): Promise<OutgoingEcashOperation[]> {
    return this.table.where('claim').equals(claim).toArray()
  }

  async listByDeliveryState(delivery: OutgoingDeliveryState): Promise<OutgoingEcashOperation[]> {
    return this.table.where('delivery').equals(delivery).toArray()
  }
}
