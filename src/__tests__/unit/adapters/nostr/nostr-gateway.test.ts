import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock nostr-tools before import
const mockPublish = vi.fn().mockReturnValue([Promise.resolve()])
const mockQuerySync = vi.fn().mockResolvedValue([])
const mockEnsureRelay = vi.fn().mockResolvedValue({
  subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
})
const mockClose = vi.fn()

vi.mock('nostr-tools/pool', () => ({
  SimplePool: class MockSimplePool {
    publish = mockPublish
    querySync = mockQuerySync
    ensureRelay = mockEnsureRelay
    close = mockClose
  },
}))

vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn().mockImplementation((event, _sk) => ({
    ...event,
    id: 'signed-event-id',
    pubkey: 'test-pubkey',
    sig: 'test-sig',
  })),
  verifyEvent: vi.fn().mockReturnValue(true),
  getPublicKey: vi.fn().mockReturnValue('derived-pubkey'),
  nip19: {
    npubEncode: vi.fn().mockReturnValue('npub1test'),
    nprofileEncode: vi.fn().mockReturnValue('nprofile1test'),
    decode: vi.fn().mockReturnValue({ type: 'npub', data: 'hex-pubkey' }),
  },
  nip17: {
    wrapEvent: vi.fn().mockReturnValue({ id: 'wrapped', kind: 1059, content: 'encrypted', tags: [], pubkey: 'sender', sig: 'sig', created_at: 0 }),
    unwrapEvent: vi.fn().mockReturnValue({ content: 'hello', pubkey: 'sender-pubkey' }),
  },
}))

vi.mock('@noble/hashes/utils.js', () => ({
  hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
}))

vi.mock('nostr-tools/nip44', () => ({
  v2: {
    utils: {
      getConversationKey: vi.fn().mockReturnValue(new Uint8Array(32)),
    },
    encrypt: vi.fn().mockReturnValue('encrypted-payload'),
    decrypt: vi.fn().mockReturnValue('decrypted-content'),
  },
}))

import { NostrGatewayAdapter } from '@/adapters/nostr/nostr-gateway'
import type { NostrFilter } from '@/core/domain/nostr'

describe('NostrGatewayAdapter', () => {
  let gateway: NostrGatewayAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    gateway = new NostrGatewayAdapter({ privateKeyHex: 'a'.repeat(64) })
  })

  // ─── connect / disconnect ───

  describe('connect', () => {
    it('connects to relays via pool.ensureRelay', async () => {
      await gateway.connect(['wss://relay1.test', 'wss://relay2.test'])

      expect(mockEnsureRelay).toHaveBeenCalledTimes(2)
      expect(mockEnsureRelay).toHaveBeenCalledWith('wss://relay1.test')
      expect(mockEnsureRelay).toHaveBeenCalledWith('wss://relay2.test')
    })

    it('continues on relay connection failure', async () => {
      mockEnsureRelay
        .mockRejectedValueOnce(new Error('connection failed'))
        .mockResolvedValueOnce({ subscribe: vi.fn() })

      await gateway.connect(['wss://bad.test', 'wss://good.test'])

      const status = gateway.getRelayStatus()
      expect(status).toHaveLength(1)
      expect(status[0].url).toBe('wss://good.test')
    })
  })

  describe('disconnect', () => {
    it('closes pool and clears connected relays', async () => {
      await gateway.connect(['wss://relay.test'])
      await gateway.disconnect()

      expect(mockClose).toHaveBeenCalledWith(['wss://relay.test'])
      expect(gateway.getRelayStatus()).toHaveLength(0)
    })
  })

  // ─── getRelayStatus ───

  describe('getRelayStatus', () => {
    it('returns connected relays', async () => {
      await gateway.connect(['wss://relay1.test', 'wss://relay2.test'])

      const status = gateway.getRelayStatus()
      expect(status).toHaveLength(2)
      expect(status[0]).toEqual({ url: 'wss://relay1.test', connected: true })
    })

    it('returns empty when not connected', () => {
      expect(gateway.getRelayStatus()).toHaveLength(0)
    })
  })

  // ─── publish ───

  describe('publish', () => {
    it('signs and publishes event to connected relays', async () => {
      await gateway.connect(['wss://relay.test'])

      const event = await gateway.publish({
        pubkey: 'test-pubkey',
        created_at: 1000,
        kind: 1,
        tags: [],
        content: 'hello',
      })

      expect(mockPublish).toHaveBeenCalled()
      expect(event.id).toBe('signed-event-id')
      expect(event.sig).toBe('test-sig')
    })

    it('throws when no relays connected', async () => {
      await expect(gateway.publish({
        pubkey: 'test',
        created_at: 1000,
        kind: 1,
        tags: [],
        content: 'hello',
      })).rejects.toThrow('No connected relays')
    })

    it('throws when all relays fail to publish', async () => {
      await gateway.connect(['wss://relay.test'])
      mockPublish.mockReturnValueOnce([Promise.reject(new Error('publish failed'))])

      await expect(gateway.publish({
        pubkey: 'test',
        created_at: 1000,
        kind: 1,
        tags: [],
        content: 'hello',
      })).rejects.toThrow('Failed to publish to any relay')
    })
  })

  // ─── queryEvents ───

  describe('queryEvents', () => {
    it('queries events from connected relays', async () => {
      const mockEvents = [
        { id: 'e1', pubkey: 'p1', created_at: 1, kind: 1, tags: [], content: '', sig: 's1' },
      ]
      mockQuerySync.mockResolvedValueOnce(mockEvents)

      await gateway.connect(['wss://relay.test'])
      const filter: NostrFilter = { kinds: [1], limit: 10 }
      const events = await gateway.queryEvents([filter])

      expect(mockQuerySync).toHaveBeenCalled()
      expect(events).toHaveLength(1)
      expect(events[0].id).toBe('e1')
    })

    it('returns empty array when no relays connected', async () => {
      const events = await gateway.queryEvents([{ kinds: [1] }])
      expect(events).toHaveLength(0)
    })

    it('handles multiple filters', async () => {
      mockQuerySync
        .mockResolvedValueOnce([{ id: 'e1', pubkey: 'p', created_at: 1, kind: 1, tags: [], content: '', sig: 's' }])
        .mockResolvedValueOnce([{ id: 'e2', pubkey: 'p', created_at: 2, kind: 2, tags: [], content: '', sig: 's' }])

      await gateway.connect(['wss://relay.test'])
      const events = await gateway.queryEvents([{ kinds: [1] }, { kinds: [2] }])

      expect(events).toHaveLength(2)
    })
  })

  // ─── subscribe ───

  describe('subscribe', () => {
    it('subscribes to events and returns cleanup function', async () => {
      const mockSub = { close: vi.fn() }
      const mockRelay = { subscribe: vi.fn().mockReturnValue(mockSub) }

      await gateway.connect(['wss://relay.test'])

      // After connect, override ensureRelay for subscribe call
      mockEnsureRelay.mockResolvedValueOnce(mockRelay)

      const handler = vi.fn()
      const unsubscribe = gateway.subscribe([{ kinds: [1] }], handler)

      // Wait for async relay connection
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockRelay.subscribe).toHaveBeenCalled()

      unsubscribe()
      expect(mockSub.close).toHaveBeenCalled()
    })
  })

  // ─── sendPrivateDirectMessage ───

  describe('sendPrivateDirectMessage', () => {
    it('wraps content as NIP-17 gift wrap and publishes', async () => {
      await gateway.sendPrivateDirectMessage({
        recipientPubkey: 'recipient-hex',
        content: 'cashuBtoken...',
        relays: ['wss://relay.test'],
      })

      // connect called with relays
      expect(mockEnsureRelay).toHaveBeenCalledWith('wss://relay.test')
      // publish called with wrapped event
      expect(mockPublish).toHaveBeenCalled()
    })

    it('throws when all relays fail', async () => {
      mockPublish.mockReturnValueOnce([Promise.reject(new Error('fail'))])

      await expect(gateway.sendPrivateDirectMessage({
        recipientPubkey: 'recipient-hex',
        content: 'cashuBtoken...',
        relays: ['wss://relay.test'],
      })).rejects.toThrow('Failed to send direct message')
    })
  })
})
