import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NostrService } from '@/services/nostr/nostr.service'

// Mock nostr-tools
vi.mock('nostr-tools', () => ({
  getPublicKey: vi.fn().mockReturnValue('mock-pubkey'),
  finalizeEvent: vi.fn().mockImplementation((event) => ({
    ...event,
    id: 'mock-event-id-' + Math.random().toString(36).slice(2),
    sig: 'mock-signature',
    pubkey: 'mock-pubkey',
  })),
  verifyEvent: vi.fn().mockReturnValue(true),
}))

// Mock simple-pool with class
vi.mock('nostr-tools/pool', () => {
  class MockSimplePool {
    subscribeMany = vi.fn().mockReturnValue({ close: vi.fn() })
    querySync = vi.fn().mockResolvedValue([])
    publish = vi.fn().mockReturnValue([Promise.resolve('wss://relay1.com')])
    close = vi.fn()
  }
  return { SimplePool: MockSimplePool }
})

describe('NostrService', () => {
  let service: NostrService
  const testPrivateKey = '0'.repeat(64)

  beforeEach(() => {
    service = new NostrService()
  })

  describe('createEvent', () => {
    it('should create a signed event', () => {
      const event = service.createEvent(
        testPrivateKey,
        1,
        'Hello world',
        []
      )

      expect(event.kind).toBe(1)
      expect(event.content).toBe('Hello world')
      expect(event.id).toBeDefined()
      expect(event.sig).toBeDefined()
    })

    it('should include tags', () => {
      const tags = [['p', 'pubkey1'], ['e', 'eventid1']]
      const event = service.createEvent(
        testPrivateKey,
        1,
        'content',
        tags
      )

      expect(event.tags).toEqual(tags)
    })
  })

  describe('createKind10019Event', () => {
    it('should create NutZap info event', () => {
      const event = service.createKind10019Event(
        testPrivateKey,
        ['https://mint1.com', 'https://mint2.com'],
        'p2pk-pubkey-hex'
      )

      expect(event.kind).toBe(10019)
      expect(event.tags).toContainEqual(['mint', 'https://mint1.com', 'sat'])
      expect(event.tags).toContainEqual(['mint', 'https://mint2.com', 'sat'])
      expect(event.tags).toContainEqual(['pubkey', 'p2pk-pubkey-hex'])
    })
  })

  describe('createKind10002Event', () => {
    it('should create relay list event', () => {
      const relays = ['wss://relay1.com', 'wss://relay2.com']
      const event = service.createKind10002Event(testPrivateKey, relays)

      expect(event.kind).toBe(10002)
      expect(event.tags).toContainEqual(['r', 'wss://relay1.com'])
      expect(event.tags).toContainEqual(['r', 'wss://relay2.com'])
    })
  })

  describe('publish', () => {
    it('should publish event to relays', async () => {
      const event = service.createEvent(testPrivateKey, 1, 'test', [])
      const result = await service.publish(
        event,
        ['wss://relay1.com', 'wss://relay2.com']
      )

      expect(result.isOk()).toBe(true)
    })
  })

  describe('queryEvents', () => {
    it('should query events from relays', async () => {
      const result = await service.queryEvents(
        ['wss://relay.com'],
        { kinds: [1], limit: 10 }
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('parseNutZapInfo', () => {
    it('should parse kind 10019 event with unit markers', () => {
      const event = {
        kind: 10019,
        tags: [
          ['mint', 'https://mint1.com', 'sat'],
          ['mint', 'https://mint2.com', 'sat'],
          ['pubkey', 'p2pk-key'],
        ],
        content: '',
        created_at: Date.now(),
        pubkey: 'author-pubkey',
        id: 'event-id',
        sig: 'sig',
      }

      const info = service.parseNutZapInfo(event)

      expect(info.mints).toEqual(['https://mint1.com', 'https://mint2.com'])
      expect(info.p2pkPubkey).toBe('p2pk-key')
    })

    it('should parse mint tags without unit markers (backwards compat)', () => {
      const event = {
        kind: 10019,
        tags: [
          ['mint', 'https://mint1.com'],
          ['mint', 'https://mint2.com'],
          ['pubkey', 'p2pk-key'],
        ],
        content: '',
        created_at: Date.now(),
        pubkey: 'author-pubkey',
        id: 'event-id',
        sig: 'sig',
      }

      const info = service.parseNutZapInfo(event)

      expect(info.mints).toEqual(['https://mint1.com', 'https://mint2.com'])
      expect(info.p2pkPubkey).toBe('p2pk-key')
    })

    it('should accept multi-unit mint tags containing sat', () => {
      const event = {
        kind: 10019,
        tags: [
          ['mint', 'https://mint1.com', 'usd', 'sat'],
          ['mint', 'https://mint-usd-only.com', 'usd'],
          ['pubkey', 'p2pk-key'],
        ],
        content: '',
        created_at: Date.now(),
        pubkey: 'author-pubkey',
        id: 'event-id',
        sig: 'sig',
      }

      const info = service.parseNutZapInfo(event)

      expect(info.mints).toEqual(['https://mint1.com'])
      expect(info.p2pkPubkey).toBe('p2pk-key')
    })
  })

  describe('parseRelayList', () => {
    it('should parse kind 10002 event', () => {
      const event = {
        kind: 10002,
        tags: [
          ['r', 'wss://relay1.com'],
          ['r', 'wss://relay2.com', 'read'],
          ['r', 'wss://relay3.com', 'write'],
        ],
        content: '',
        created_at: Date.now(),
        pubkey: 'author-pubkey',
        id: 'event-id',
        sig: 'sig',
      }

      const relays = service.parseRelayList(event)

      expect(relays).toContain('wss://relay1.com')
      expect(relays).toContain('wss://relay2.com')
      expect(relays).toContain('wss://relay3.com')
    })
  })
})
