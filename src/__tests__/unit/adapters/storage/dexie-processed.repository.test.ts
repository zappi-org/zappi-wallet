import { beforeEach, describe, expect, it } from 'vitest'
import { DexieProcessedRepository } from '@/adapters/storage/dexie/dexie-processed.repository'
import { resetDatabase } from '@/adapters/storage/dexie/schema'

describe('DexieProcessedRepository', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('treats only success and skipped records as processed for retry gating', async () => {
    const repo = new DexieProcessedRepository()

    await repo.save({
      externalId: 'event-failed',
      txId: 'tx-failed',
      processedAt: 1_000,
      result: 'failed',
      error: 'temporary failure',
    })
    await repo.save({
      externalId: 'event-success',
      txId: 'tx-success',
      processedAt: 2_000,
      result: 'success',
    })
    await repo.save({
      externalId: 'event-skipped',
      txId: 'tx-skipped',
      processedAt: 3_000,
      result: 'skipped',
    })

    await expect(repo.exists('event-failed')).resolves.toBe(false)
    await expect(repo.existsByTxId('tx-failed')).resolves.toBe(false)
    await expect(repo.exists('event-success')).resolves.toBe(true)
    await expect(repo.existsByTxId('tx-success')).resolves.toBe(true)
    await expect(repo.exists('event-skipped')).resolves.toBe(true)
    await expect(repo.existsByTxId('tx-skipped')).resolves.toBe(true)
  })
})
