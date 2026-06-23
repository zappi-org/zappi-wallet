/**
 * DexiePendingTransferStore — PendingTransferStore driven adapter
 *
 * pendingTransfers 테이블에 통합 전송 라이프사이클 상태를 영속화.
 */

import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import { getDatabase } from './schema'
import type { PendingTransferRecord } from './schema'

function toRecord(transfer: PendingTransfer): PendingTransferRecord {
  return {
    id: transfer.id,
    txId: transfer.txId,
    direction: transfer.direction,
    protocol: (transfer.transportRef as { protocol?: string })?.protocol ?? 'unknown',
    phase: transfer.phase,
    finality: transfer.finality,
    onExpiry: transfer.onExpiry,
    expiresAt: transfer.expiresAt,
    amount: transfer.amount,
    transportRef: JSON.stringify(transfer.transportRef),
    createdAt: transfer.createdAt,
    updatedAt: transfer.updatedAt,
  }
}

function fromRecord(record: PendingTransferRecord): PendingTransfer {
  return {
    id: record.id,
    txId: record.txId,
    direction: record.direction as 'outgoing' | 'incoming',
    phase: record.phase as TransferPhase,
    finality: record.finality as 'immediate' | 'deferred' | 'revocable',
    onExpiry: record.onExpiry as 'fail' | 'reclaim' | 'expire',
    expiresAt: record.expiresAt,
    amount: record.amount,
    transportRef: JSON.parse(record.transportRef),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export class DexiePendingTransferStore implements PendingTransferStore {
  private get db() {
    return getDatabase()
  }

  async create(transfer: PendingTransfer): Promise<void> {
    await this.db.pendingTransfers.put(toRecord(transfer))
  }

  async get(id: string): Promise<PendingTransfer | null> {
    const record = await this.db.pendingTransfers.get(id)
    return record ? fromRecord(record) : null
  }

  async update(id: string, changes: Partial<PendingTransfer>): Promise<void> {
    const existing = await this.db.pendingTransfers.get(id)
    if (!existing) throw new Error(`Transfer not found: ${id}`)

    const merged: PendingTransferRecord = {
      ...existing,
      ...(changes.txId !== undefined && { txId: changes.txId }),
      ...(changes.direction !== undefined && { direction: changes.direction }),
      ...(changes.phase !== undefined && { phase: changes.phase }),
      ...(changes.finality !== undefined && { finality: changes.finality }),
      ...(changes.onExpiry !== undefined && { onExpiry: changes.onExpiry }),
      ...(changes.expiresAt !== undefined && { expiresAt: changes.expiresAt }),
      ...(changes.amount !== undefined && { amount: changes.amount }),
      ...(changes.transportRef !== undefined && { transportRef: JSON.stringify(changes.transportRef) }),
      ...(changes.createdAt !== undefined && { createdAt: changes.createdAt }),
      ...(changes.updatedAt !== undefined && { updatedAt: changes.updatedAt }),
    }

    await this.db.pendingTransfers.put(merged)
  }

  async delete(id: string): Promise<void> {
    await this.db.pendingTransfers.delete(id)
  }

  async listByPhase(phases: TransferPhase[]): Promise<PendingTransfer[]> {
    const records = await this.db.pendingTransfers
      .where('phase')
      .anyOf(phases)
      .toArray()
    return records.map(fromRecord)
  }

  async listByTxId(txId: string): Promise<PendingTransfer[]> {
    const records = await this.db.pendingTransfers
      .where('txId')
      .equals(txId)
      .toArray()
    return records.map(fromRecord)
  }

  async listExpired(before: number): Promise<PendingTransfer[]> {
    const records = await this.db.pendingTransfers
      .where('expiresAt')
      .below(before)
      .toArray()
    return records
      .filter((r) => r.expiresAt != null)
      .map(fromRecord)
  }

  async listActive(): Promise<PendingTransfer[]> {
    return this.listByPhase(['submitted', 'in_transit', 'awaiting_confirmation'])
  }
}
