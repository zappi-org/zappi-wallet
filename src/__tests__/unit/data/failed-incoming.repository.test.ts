import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FailedIncomingRepository } from '@/data/repositories/failed-incoming.repository'
import { resetDatabase } from '@/data/database'
import type { FailedIncoming } from '@/core/types'

describe('FailedIncomingRepository', () => {
  let repo: FailedIncomingRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new FailedIncomingRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  const createMockItem = (overrides: Partial<FailedIncoming> = {}): FailedIncoming => ({
    id: 'item-' + Math.random().toString(36).slice(2),
    payload: 'cashuBmock...',
    accountId: 'https://mint.example.com',
    amount: 1000,
    error: 'Connection failed',
    errorCode: 'MINT_CONNECTION',
    isRetryable: true,
    attemptCount: 1,
    lastAttemptAt: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  })

  describe('save', () => {
    it('should save a failed incoming', async () => {
      const item = createMockItem()

      await repo.save(item)
      const saved = await repo.findById(item.id)

      expect(saved).toEqual(item)
    })

    it('should update existing item', async () => {
      const item = createMockItem({ attemptCount: 1 })
      await repo.save(item)

      item.attemptCount = 2
      item.lastAttemptAt = Date.now()
      await repo.save(item)

      const updated = await repo.findById(item.id)
      expect(updated?.attemptCount).toBe(2)
    })
  })

  describe('findById', () => {
    it('should return null for non-existent item', async () => {
      const result = await repo.findById('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('findAll', () => {
    it('should return all items sorted by createdAt desc', async () => {
      const item1 = createMockItem({ createdAt: 1000 })
      const item2 = createMockItem({ createdAt: 3000 })
      const item3 = createMockItem({ createdAt: 2000 })

      await repo.save(item1)
      await repo.save(item2)
      await repo.save(item3)

      const result = await repo.findAll()

      expect(result).toHaveLength(3)
      expect(result[0].createdAt).toBe(3000)
      expect(result[1].createdAt).toBe(2000)
      expect(result[2].createdAt).toBe(1000)
    })
  })

  describe('findRetryable', () => {
    it('should return only retryable items', async () => {
      await repo.save(createMockItem({ isRetryable: true }))
      await repo.save(createMockItem({ isRetryable: false }))
      await repo.save(createMockItem({ isRetryable: true }))

      const result = await repo.findRetryable()

      expect(result).toHaveLength(2)
      expect(result.every((s) => s.isRetryable)).toBe(true)
    })
  })

  describe('findByAccount', () => {
    it('should filter by account ID', async () => {
      await repo.save(createMockItem({ accountId: 'https://mint1.com' }))
      await repo.save(createMockItem({ accountId: 'https://mint2.com' }))

      const result = await repo.findByAccount('https://mint1.com')

      expect(result).toHaveLength(1)
      expect(result[0].accountId).toBe('https://mint1.com')
    })
  })

  describe('incrementAttempt', () => {
    it('should increment attempt count and update lastAttemptAt', async () => {
      const item = createMockItem({ attemptCount: 1, lastAttemptAt: 1000 })
      await repo.save(item)

      const before = Date.now()
      await repo.incrementAttempt(item.id)
      const after = Date.now()

      const updated = await repo.findById(item.id)
      expect(updated?.attemptCount).toBe(2)
      expect(updated?.lastAttemptAt).toBeGreaterThanOrEqual(before)
      expect(updated?.lastAttemptAt).toBeLessThanOrEqual(after)
    })
  })

  describe('markAsNonRetryable', () => {
    it('should set isRetryable to false', async () => {
      const item = createMockItem({ isRetryable: true })
      await repo.save(item)

      await repo.markAsNonRetryable(item.id)

      const updated = await repo.findById(item.id)
      expect(updated?.isRetryable).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete an item', async () => {
      const item = createMockItem()
      await repo.save(item)

      await repo.delete(item.id)
      const result = await repo.findById(item.id)

      expect(result).toBeNull()
    })
  })

  describe('count', () => {
    it('should return correct count', async () => {
      await repo.save(createMockItem())
      await repo.save(createMockItem())

      const count = await repo.count()

      expect(count).toBe(2)
    })
  })

  describe('countRetryable', () => {
    it('should count only retryable items', async () => {
      await repo.save(createMockItem({ isRetryable: true }))
      await repo.save(createMockItem({ isRetryable: false }))
      await repo.save(createMockItem({ isRetryable: true }))

      const count = await repo.countRetryable()

      expect(count).toBe(2)
    })
  })
})
