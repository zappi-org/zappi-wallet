import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProcessedRepository } from '@/data/repositories/processed.repository'
import { resetDatabase } from '@/data/database'
import type { ProcessedRecord } from '@/core/types'

describe('ProcessedRepository', () => {
  let repo: ProcessedRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new ProcessedRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  const createMockRecord = (overrides: Partial<ProcessedRecord> = {}): ProcessedRecord => ({
    externalId: 'rec-' + Math.random().toString(36).slice(2),
    processedAt: Date.now(),
    result: 'success',
    ...overrides,
  })

  describe('save', () => {
    it('should save a processed record', async () => {
      const record = createMockRecord()

      await repo.save(record)
      const saved = await repo.findById(record.externalId)

      expect(saved).toEqual(record)
    })
  })

  describe('findById', () => {
    it('should return null for non-existent record', async () => {
      const result = await repo.findById('non-existent')

      expect(result).toBeNull()
    })

    it('should return the record if it exists', async () => {
      const record = createMockRecord()
      await repo.save(record)

      const result = await repo.findById(record.externalId)

      expect(result).toEqual(record)
    })
  })

  describe('findByTxId', () => {
    it('should return null for non-existent txId', async () => {
      const result = await repo.findByTxId('non-existent')

      expect(result).toBeNull()
    })

    it('should return the record if txId exists', async () => {
      const record = createMockRecord({ txId: 'tx-123' })
      await repo.save(record)

      const result = await repo.findByTxId('tx-123')

      expect(result).toEqual(record)
    })
  })

  describe('exists', () => {
    it('should return false for non-existent record', async () => {
      const result = await repo.exists('non-existent')

      expect(result).toBe(false)
    })

    it('should return true if record exists', async () => {
      const record = createMockRecord()
      await repo.save(record)

      const result = await repo.exists(record.externalId)

      expect(result).toBe(true)
    })
  })

  describe('existsByTxId', () => {
    it('should return false for non-existent txId', async () => {
      const result = await repo.existsByTxId('non-existent')

      expect(result).toBe(false)
    })

    it('should return true if txId exists', async () => {
      const record = createMockRecord({ txId: 'tx-456' })
      await repo.save(record)

      const result = await repo.existsByTxId('tx-456')

      expect(result).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete a record', async () => {
      const record = createMockRecord()
      await repo.save(record)

      await repo.delete(record.externalId)
      const result = await repo.findById(record.externalId)

      expect(result).toBeNull()
    })
  })

  describe('deleteOlderThan', () => {
    it('should delete records older than specified timestamp', async () => {
      const oldRecord = createMockRecord({ processedAt: 1000 })
      const newRecord = createMockRecord({ processedAt: 3000 })

      await repo.save(oldRecord)
      await repo.save(newRecord)

      await repo.deleteOlderThan(2000)

      const oldResult = await repo.findById(oldRecord.externalId)
      const newResult = await repo.findById(newRecord.externalId)

      expect(oldResult).toBeNull()
      expect(newResult).toEqual(newRecord)
    })
  })

  describe('count', () => {
    it('should return 0 when no records', async () => {
      const count = await repo.count()

      expect(count).toBe(0)
    })

    it('should return correct count', async () => {
      await repo.save(createMockRecord())
      await repo.save(createMockRecord())

      const count = await repo.count()

      expect(count).toBe(2)
    })
  })
})
