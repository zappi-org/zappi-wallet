import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProcessedEventRepository } from '@/data/repositories/processed-event.repository'
import { resetDatabase } from '@/data/database'
import type { ProcessedEvent } from '@/core/types'

describe('ProcessedEventRepository', () => {
  let repo: ProcessedEventRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new ProcessedEventRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  const createMockEvent = (overrides: Partial<ProcessedEvent> = {}): ProcessedEvent => ({
    eventId: 'event-' + Math.random().toString(36).slice(2),
    processedAt: Date.now(),
    result: 'success',
    ...overrides,
  })

  describe('save', () => {
    it('should save a processed event', async () => {
      const event = createMockEvent()

      await repo.save(event)
      const saved = await repo.findByEventId(event.eventId)

      expect(saved).toEqual(event)
    })
  })

  describe('findByEventId', () => {
    it('should return null for non-existent event', async () => {
      const result = await repo.findByEventId('non-existent')

      expect(result).toBeNull()
    })

    it('should return the event if it exists', async () => {
      const event = createMockEvent()
      await repo.save(event)

      const result = await repo.findByEventId(event.eventId)

      expect(result).toEqual(event)
    })
  })

  describe('findByTxId', () => {
    it('should return null for non-existent txId', async () => {
      const result = await repo.findByTxId('non-existent')

      expect(result).toBeNull()
    })

    it('should return the event if txId exists', async () => {
      const event = createMockEvent({ txId: 'tx-123' })
      await repo.save(event)

      const result = await repo.findByTxId('tx-123')

      expect(result).toEqual(event)
    })
  })

  describe('exists', () => {
    it('should return false for non-existent event', async () => {
      const result = await repo.exists('non-existent')

      expect(result).toBe(false)
    })

    it('should return true if event exists', async () => {
      const event = createMockEvent()
      await repo.save(event)

      const result = await repo.exists(event.eventId)

      expect(result).toBe(true)
    })
  })

  describe('existsByTxId', () => {
    it('should return false for non-existent txId', async () => {
      const result = await repo.existsByTxId('non-existent')

      expect(result).toBe(false)
    })

    it('should return true if txId exists', async () => {
      const event = createMockEvent({ txId: 'tx-456' })
      await repo.save(event)

      const result = await repo.existsByTxId('tx-456')

      expect(result).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete an event', async () => {
      const event = createMockEvent()
      await repo.save(event)

      await repo.delete(event.eventId)
      const result = await repo.findByEventId(event.eventId)

      expect(result).toBeNull()
    })
  })

  describe('deleteOlderThan', () => {
    it('should delete events older than specified timestamp', async () => {
      const oldEvent = createMockEvent({ processedAt: 1000 })
      const newEvent = createMockEvent({ processedAt: 3000 })

      await repo.save(oldEvent)
      await repo.save(newEvent)

      await repo.deleteOlderThan(2000)

      const oldResult = await repo.findByEventId(oldEvent.eventId)
      const newResult = await repo.findByEventId(newEvent.eventId)

      expect(oldResult).toBeNull()
      expect(newResult).toEqual(newEvent)
    })
  })

  describe('count', () => {
    it('should return 0 when no events', async () => {
      const count = await repo.count()

      expect(count).toBe(0)
    })

    it('should return correct count', async () => {
      await repo.save(createMockEvent())
      await repo.save(createMockEvent())

      const count = await repo.count()

      expect(count).toBe(2)
    })
  })
})
