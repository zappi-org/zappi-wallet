import type { EventBus } from '@/core/events/event-bus'
import type {
  SwapOutRecord,
  SwapOutStore,
  SwapOutUpdate,
} from '@/core/ports/driven/swap-out-store.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import {
  isRecorded,
  reachedDispatch,
  transactionFor,
} from '@/core/services/swap-out-transaction'

const MAX_UPDATE_TRIES = 5

export interface SwapOutRecordWriterLogger {
  warn(message: string): void
}

export interface SwapOutRecordWriterDeps {
  store: SwapOutStore
  txRepo: Pick<TransactionRepository, 'save' | 'getById' | 'update'>
  eventBus: EventBus
  now: () => number
  onPersisted: (record: SwapOutRecord) => void
  logger?: SwapOutRecordWriterLogger
}

export class SwapOutRecordWriter {
  private readonly store: SwapOutStore
  private readonly txRepo: SwapOutRecordWriterDeps['txRepo']
  private readonly eventBus: EventBus
  private readonly now: () => number
  private readonly onPersisted: (record: SwapOutRecord) => void
  private readonly logger?: SwapOutRecordWriterLogger

  constructor(deps: SwapOutRecordWriterDeps) {
    this.store = deps.store
    this.txRepo = deps.txRepo
    this.eventBus = deps.eventBus
    this.now = deps.now
    this.onPersisted = deps.onPersisted
    this.logger = deps.logger
  }

  async writeOnce(
    record: SwapOutRecord,
    expectedVersion: number,
    changes: SwapOutUpdate,
  ): Promise<SwapOutRecord | null> {
    const updatedAt = this.now()
    const applied = await this.store.update(record.id, expectedVersion, {
      ...changes,
      updatedAt,
    })
    if (!applied) return null
    const { secrets: _secrets, ...persisted } = changes
    const next: SwapOutRecord = {
      ...record,
      ...persisted,
      updatedAt,
      version: expectedVersion + 1,
    }
    await this.syncTransaction(next)
    this.onPersisted(next)
    return next
  }

  async persist(
    id: string,
    mutate: (record: SwapOutRecord) => SwapOutUpdate | null,
  ): Promise<SwapOutRecord | null> {
    for (let attempt = 0; attempt < MAX_UPDATE_TRIES; attempt++) {
      const record = await this.store.get(id)
      if (!record) return null
      const changes = mutate(record)
      if (!changes) return null
      const updatedAt = this.now()
      const applied = await this.store.update(id, record.version, {
        ...changes,
        updatedAt,
      })
      if (!applied) continue
      const { secrets: _secrets, ...persisted } = changes
      const next: SwapOutRecord = {
        ...record,
        ...persisted,
        updatedAt,
        version: record.version + 1,
      }
      await this.syncTransaction(next)
      this.onPersisted(next)
      return next
    }
    this.logger?.warn(`payout update gave up: ${id}`)
    return null
  }

  async syncTransaction(record: SwapOutRecord): Promise<boolean> {
    if (!reachedDispatch(record)) return true
    try {
      const existing = await this.txRepo.getById(record.id)
      const transaction = transactionFor(record, existing)
      if (isRecorded(existing, transaction)) return true
      if (existing === null) {
        await this.txRepo.save(transaction)
      } else {
        await this.txRepo.update(record.id, transaction)
      }
      this.eventBus.emit({
        type: 'transactions:changed',
        payload: { reason: 'swap-out', txId: record.id },
      })
      return true
    } catch (error) {
      this.logger?.warn(
        `payout transaction record failed: ${record.id} ${error instanceof Error ? error.message : ''}`,
      )
      return false
    }
  }
}
