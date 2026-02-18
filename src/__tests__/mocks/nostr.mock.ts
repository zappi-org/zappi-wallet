import { vi } from 'vitest'

/**
 * Mock Nostr event
 */
export function createMockEvent(overrides: Partial<{
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}> = {}) {
  return {
    id: overrides.id ?? 'mock-event-id-' + Math.random().toString(36).slice(2),
    pubkey: overrides.pubkey ?? 'mock-pubkey-' + Math.random().toString(36).slice(2),
    created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
    kind: overrides.kind ?? 1,
    tags: overrides.tags ?? [],
    content: overrides.content ?? 'Mock content',
    sig: overrides.sig ?? 'mock-signature',
  }
}

/**
 * Mock gift-wrapped event (kind 1059)
 */
export function createMockGiftWrapEvent(overrides: Partial<{
  id: string
  pubkey: string
  recipientPubkey: string
  content: string
}> = {}) {
  return createMockEvent({
    ...overrides,
    kind: 1059,
    tags: [['p', overrides.recipientPubkey ?? 'mock-recipient-pubkey']],
    content: overrides.content ?? 'encrypted-content',
  })
}

/**
 * Mock kind 10019 (NutZap info)
 */
export function createMockNutzapInfoEvent(overrides: Partial<{
  pubkey: string
  mints: string[]
  p2pkPubkey: string
}> = {}) {
  const mints = overrides.mints ?? ['https://mint.example.com']
  return createMockEvent({
    pubkey: overrides.pubkey,
    kind: 10019,
    tags: [
      ...mints.map((m) => ['mint', m]),
      ['pubkey', overrides.p2pkPubkey ?? 'mock-p2pk-pubkey'],
    ],
    content: '',
  })
}

/**
 * Mock kind 10002 (relay list)
 */
export function createMockRelayListEvent(overrides: Partial<{
  pubkey: string
  relays: string[]
}> = {}) {
  const relays = overrides.relays ?? ['wss://relay.example.com']
  return createMockEvent({
    pubkey: overrides.pubkey,
    kind: 10002,
    tags: relays.map((r) => ['r', r]),
    content: '',
  })
}

/**
 * Mock NIP-05 response
 */
export function createMockNip05Response(overrides: Partial<{
  names: Record<string, string>
  relays: Record<string, string[]>
}> = {}) {
  return {
    names: overrides.names ?? { '_': 'mock-pubkey' },
    relays: overrides.relays ?? { 'mock-pubkey': ['wss://relay.example.com'] },
  }
}

/**
 * Mock relay
 */
export function createMockRelay() {
  const listeners = new Map<string, Set<(event: unknown) => void>>()

  return {
    url: 'wss://mock-relay.example.com',
    status: 1, // OPEN
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    subscribe: vi.fn().mockReturnValue({
      on: vi.fn(),
      close: vi.fn(),
    }),
    publish: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, callback: (e: unknown) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set())
      }
      listeners.get(event)!.add(callback)
    }),
    off: vi.fn((event: string, callback: (e: unknown) => void) => {
      listeners.get(event)?.delete(callback)
    }),
    // Helper to emit events in tests
    _emit: (event: string, data: unknown) => {
      listeners.get(event)?.forEach((cb) => cb(data))
    },
  }
}

/**
 * Mock NDK
 */
export function createMockNDK() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({
      on: vi.fn(),
      stop: vi.fn(),
    }),
    publish: vi.fn().mockResolvedValue(undefined),
    fetchEvent: vi.fn().mockResolvedValue(null),
    fetchEvents: vi.fn().mockResolvedValue(new Set()),
    pool: {
      relays: new Map(),
    },
  }
}

/**
 * Mock nostr-tools module
 */
export const mockNostrTools = {
  generateSecretKey: vi.fn().mockReturnValue(new Uint8Array(32).fill(1)),
  getPublicKey: vi.fn().mockReturnValue('mock-public-key'),
  finalizeEvent: vi.fn().mockImplementation((event) => ({
    ...event,
    id: 'mock-event-id',
    sig: 'mock-signature',
  })),
  verifyEvent: vi.fn().mockReturnValue(true),
  nip04: {
    encrypt: vi.fn().mockResolvedValue('encrypted'),
    decrypt: vi.fn().mockResolvedValue('decrypted'),
  },
  nip44: {
    encrypt: vi.fn().mockReturnValue('encrypted'),
    decrypt: vi.fn().mockReturnValue('decrypted'),
  },
  nip19: {
    npubEncode: vi.fn().mockReturnValue('npub1...'),
    nsecEncode: vi.fn().mockReturnValue('nsec1...'),
    decode: vi.fn().mockReturnValue({ type: 'npub', data: 'mock-data' }),
  },
}
