import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FailedSwapRepository } from '@/data/repositories/failed-swap.repository'
import { resetDatabase } from '@/data/database'
import type { FailedSwap } from '@/core/types'

describe('FailedSwapRepository', () => {
  let repo: FailedSwapRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new FailedSwapRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  const createMockSwap = (overrides: Partial<FailedSwap> = {}): FailedSwap => ({
    id: 'swap-' + Math.random().toString(36).slice(2),
    token: 'cashuBmock...',
    mintUrl: 'https://mint.example.com',
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
    it('should save a failed swap', async () => {
      const swap = createMockSwap()

      await repo.save(swap)
      const saved = await repo.findById(swap.id)

      expect(saved).toEqual(swap)
    })

    it('should update existing swap', async () => {
      const swap = createMockSwap({ attemptCount: 1 })
      await repo.save(swap)

      swap.attemptCount = 2
      swap.lastAttemptAt = Date.now()
      await repo.save(swap)

      const updated = await repo.findById(swap.id)
      expect(updated?.attemptCount).toBe(2)
    })
  })

  describe('findById', () => {
    it('should return null for non-existent swap', async () => {
      const result = await repo.findById('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('findAll', () => {
    it('should return all swaps sorted by createdAt desc', async () => {
      const swap1 = createMockSwap({ createdAt: 1000 })
      const swap2 = createMockSwap({ createdAt: 3000 })
      const swap3 = createMockSwap({ createdAt: 2000 })

      await repo.save(swap1)
      await repo.save(swap2)
      await repo.save(swap3)

      const result = await repo.findAll()

      expect(result).toHaveLength(3)
      expect(result[0].createdAt).toBe(3000)
      expect(result[1].createdAt).toBe(2000)
      expect(result[2].createdAt).toBe(1000)
    })
  })

  describe('findRetryable', () => {
    it('should return only retryable swaps', async () => {
      await repo.save(createMockSwap({ isRetryable: true }))
      await repo.save(createMockSwap({ isRetryable: false }))
      await repo.save(createMockSwap({ isRetryable: true }))

      const result = await repo.findRetryable()

      expect(result).toHaveLength(2)
      expect(result.every((s) => s.isRetryable)).toBe(true)
    })
  })

  describe('findByMint', () => {
    it('should filter by mint URL', async () => {
      await repo.save(createMockSwap({ mintUrl: 'https://mint1.com' }))
      await repo.save(createMockSwap({ mintUrl: 'https://mint2.com' }))

      const result = await repo.findByMint('https://mint1.com')

      expect(result).toHaveLength(1)
      expect(result[0].mintUrl).toBe('https://mint1.com')
    })
  })

  describe('incrementAttempt', () => {
    it('should increment attempt count and update lastAttemptAt', async () => {
      const swap = createMockSwap({ attemptCount: 1, lastAttemptAt: 1000 })
      await repo.save(swap)

      const before = Date.now()
      await repo.incrementAttempt(swap.id)
      const after = Date.now()

      const updated = await repo.findById(swap.id)
      expect(updated?.attemptCount).toBe(2)
      expect(updated?.lastAttemptAt).toBeGreaterThanOrEqual(before)
      expect(updated?.lastAttemptAt).toBeLessThanOrEqual(after)
    })
  })

  describe('markAsNonRetryable', () => {
    it('should set isRetryable to false', async () => {
      const swap = createMockSwap({ isRetryable: true })
      await repo.save(swap)

      await repo.markAsNonRetryable(swap.id)

      const updated = await repo.findById(swap.id)
      expect(updated?.isRetryable).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete a swap', async () => {
      const swap = createMockSwap()
      await repo.save(swap)

      await repo.delete(swap.id)
      const result = await repo.findById(swap.id)

      expect(result).toBeNull()
    })
  })

  describe('count', () => {
    it('should return correct count', async () => {
      await repo.save(createMockSwap())
      await repo.save(createMockSwap())

      const count = await repo.count()

      expect(count).toBe(2)
    })
  })

  describe('countRetryable', () => {
    it('should count only retryable swaps', async () => {
      await repo.save(createMockSwap({ isRetryable: true }))
      await repo.save(createMockSwap({ isRetryable: false }))
      await repo.save(createMockSwap({ isRetryable: true }))

      const count = await repo.countRetryable()

      expect(count).toBe(2)
    })
  })
})
