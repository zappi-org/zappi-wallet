import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TransactionRepository } from '@/data/repositories/transaction.repository'
import { resetDatabase } from '@/data/database'
import type { Transaction } from '@/core/types'

describe('TransactionRepository', () => {
  let repo: TransactionRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new TransactionRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  const createMockTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 'tx-' + Math.random().toString(36).slice(2),
    direction: 'receive',
    type: 'lightning',
    amount: 1000,
    mintUrl: 'https://mint.example.com',
    status: 'completed',
    createdAt: Date.now(),
    ...overrides,
  })

  describe('save', () => {
    it('should save a new transaction', async () => {
      const tx = createMockTransaction()

      await repo.save(tx)
      const saved = await repo.findById(tx.id)

      expect(saved).toEqual(tx)
    })

    it('should update an existing transaction', async () => {
      const tx = createMockTransaction({ status: 'pending' })
      await repo.save(tx)

      tx.status = 'completed'
      tx.completedAt = Date.now()
      await repo.save(tx)

      const updated = await repo.findById(tx.id)
      expect(updated?.status).toBe('completed')
      expect(updated?.completedAt).toBeDefined()
    })
  })

  describe('findById', () => {
    it('should return null for non-existent transaction', async () => {
      const result = await repo.findById('non-existent')

      expect(result).toBeNull()
    })

    it('should return the transaction if it exists', async () => {
      const tx = createMockTransaction()
      await repo.save(tx)

      const result = await repo.findById(tx.id)

      expect(result).toEqual(tx)
    })
  })

  describe('findAll', () => {
    it('should return empty array when no transactions', async () => {
      const result = await repo.findAll()

      expect(result).toEqual([])
    })

    it('should return all transactions sorted by createdAt desc', async () => {
      const tx1 = createMockTransaction({ createdAt: 1000 })
      const tx2 = createMockTransaction({ createdAt: 2000 })
      const tx3 = createMockTransaction({ createdAt: 3000 })

      await repo.save(tx1)
      await repo.save(tx2)
      await repo.save(tx3)

      const result = await repo.findAll()

      expect(result).toHaveLength(3)
      expect(result[0].createdAt).toBe(3000)
      expect(result[1].createdAt).toBe(2000)
      expect(result[2].createdAt).toBe(1000)
    })

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.save(createMockTransaction({ createdAt: i * 1000 }))
      }

      const result = await repo.findAll({ limit: 5 })

      expect(result).toHaveLength(5)
    })

    it('should respect offset parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.save(createMockTransaction({ id: `tx-${i}`, createdAt: i * 1000 }))
      }

      const result = await repo.findAll({ offset: 3, limit: 3 })

      expect(result).toHaveLength(3)
      // Sorted desc: 9000, 8000, 7000, [6000, 5000, 4000], ...
      expect(result[0].createdAt).toBe(6000)
    })
  })

  describe('findByDirection', () => {
    it('should filter by receive direction', async () => {
      await repo.save(createMockTransaction({ direction: 'receive' }))
      await repo.save(createMockTransaction({ direction: 'send' }))
      await repo.save(createMockTransaction({ direction: 'receive' }))

      const result = await repo.findByDirection('receive')

      expect(result).toHaveLength(2)
      expect(result.every((tx) => tx.direction === 'receive')).toBe(true)
    })

    it('should filter by send direction', async () => {
      await repo.save(createMockTransaction({ direction: 'receive' }))
      await repo.save(createMockTransaction({ direction: 'send' }))

      const result = await repo.findByDirection('send')

      expect(result).toHaveLength(1)
      expect(result[0].direction).toBe('send')
    })
  })

  describe('findByStatus', () => {
    it('should filter by status', async () => {
      await repo.save(createMockTransaction({ status: 'pending' }))
      await repo.save(createMockTransaction({ status: 'completed' }))
      await repo.save(createMockTransaction({ status: 'failed' }))

      const pending = await repo.findByStatus('pending')
      const completed = await repo.findByStatus('completed')

      expect(pending).toHaveLength(1)
      expect(completed).toHaveLength(1)
    })
  })

  describe('findByMint', () => {
    it('should filter by mint URL', async () => {
      await repo.save(createMockTransaction({ mintUrl: 'https://mint1.com' }))
      await repo.save(createMockTransaction({ mintUrl: 'https://mint2.com' }))
      await repo.save(createMockTransaction({ mintUrl: 'https://mint1.com' }))

      const result = await repo.findByMint('https://mint1.com')

      expect(result).toHaveLength(2)
      expect(result.every((tx) => tx.mintUrl === 'https://mint1.com')).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete a transaction', async () => {
      const tx = createMockTransaction()
      await repo.save(tx)

      await repo.delete(tx.id)
      const result = await repo.findById(tx.id)

      expect(result).toBeNull()
    })

    it('should not throw when deleting non-existent transaction', async () => {
      await expect(repo.delete('non-existent')).resolves.not.toThrow()
    })
  })

  describe('deleteAll', () => {
    it('should delete all transactions', async () => {
      await repo.save(createMockTransaction())
      await repo.save(createMockTransaction())
      await repo.save(createMockTransaction())

      await repo.deleteAll()
      const result = await repo.findAll()

      expect(result).toEqual([])
    })
  })

  describe('count', () => {
    it('should return 0 when no transactions', async () => {
      const count = await repo.count()

      expect(count).toBe(0)
    })

    it('should return correct count', async () => {
      await repo.save(createMockTransaction())
      await repo.save(createMockTransaction())
      await repo.save(createMockTransaction())

      const count = await repo.count()

      expect(count).toBe(3)
    })
  })
})
