import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ProfileService } from '@/services/profile/profile.service'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'

// Mock cashu-ts
vi.mock('@cashu/cashu-ts', () => {
  class MockCashuMint {
    mintUrl: string
    constructor(mintUrl: string) {
      this.mintUrl = mintUrl
    }
  }
  class MockCashuWallet {
    mint: MockCashuMint
    constructor(mint: MockCashuMint) {
      this.mint = mint
    }
    loadMint = vi.fn().mockResolvedValue(undefined)
  }
  return {
    CashuWallet: MockCashuWallet,
    CashuMint: MockCashuMint,
  }
})

// Mock NostrService
const mockCreateKind10019Event = vi.fn()
const mockCreateKind10002Event = vi.fn()
const mockPublish = vi.fn()

vi.mock('@/services/nostr/nostr.service', () => {
  class MockNostrService {
    createKind10019Event = mockCreateKind10019Event
    createKind10002Event = mockCreateKind10002Event
    publish = mockPublish
  }
  return {
    NostrService: MockNostrService,
  }
})

// Mock Nip05Service
const mockLookupRelaysOnly = vi.fn()

vi.mock('@/services/nip05/nip05.service', () => {
  class MockNip05Service {
    lookupRelaysOnly = mockLookupRelaysOnly
  }
  return {
    Nip05Service: MockNip05Service,
  }
})

// Mock SettingsRepository
const mockGetSettings = vi.fn()
const mockSaveSettings = vi.fn()

vi.mock('@/data/repositories/settings.repository', () => {
  class MockSettingsRepository {
    getSettings = mockGetSettings
    saveSettings = mockSaveSettings
  }
  return {
    SettingsRepository: MockSettingsRepository,
  }
})

describe('ProfileService', () => {
  let service: ProfileService
  const testPrivateKey = '0'.repeat(64)
  const testP2pkPubkey = 'p2pk-pubkey-hex'
  const testMints = ['https://mint1.com', 'https://mint2.com']
  const testRelays = ['wss://relay1.com', 'wss://relay2.com']

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()

    // Default mocks
    mockGetSettings.mockResolvedValue({
      mints: testMints,
      relays: testRelays,
    })
    mockSaveSettings.mockResolvedValue(undefined)

    mockCreateKind10019Event.mockReturnValue({
      id: 'event-10019-id',
      kind: 10019,
      pubkey: 'test-pubkey',
      content: '',
      tags: [
        ['mint', 'https://mint1.com'],
        ['mint', 'https://mint2.com'],
        ['pubkey', testP2pkPubkey],
      ],
      created_at: Math.floor(Date.now() / 1000),
      sig: 'sig',
    })

    mockCreateKind10002Event.mockReturnValue({
      id: 'event-10002-id',
      kind: 10002,
      pubkey: 'test-pubkey',
      content: '',
      tags: [
        ['r', 'wss://relay1.com'],
        ['r', 'wss://relay2.com'],
      ],
      created_at: Math.floor(Date.now() / 1000),
      sig: 'sig',
    })

    mockPublish.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: ['wss://relay1.com'],
    })

    mockLookupRelaysOnly.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: ['wss://zs-relay1.com', 'wss://zs-relay2.com'],
    })

    service = new ProfileService()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('publishNutzapInfo', () => {
    it('should create and publish kind 10019 event', async () => {
      const dmRelays = ['wss://dm-relay.com']
      const result = await service.publishNutzapInfo(
        testPrivateKey,
        testMints,
        testP2pkPubkey,
        testRelays,
        dmRelays
      )

      expect(result.isOk()).toBe(true)
      expect(mockCreateKind10019Event).toHaveBeenCalledWith(
        testPrivateKey,
        testMints,
        testP2pkPubkey,
        dmRelays
      )
      expect(mockPublish).toHaveBeenCalled()
    })

    it('should return error if publish fails', async () => {
      mockPublish.mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: { code: 'RELAY_ERROR' },
      })

      const result = await service.publishNutzapInfo(
        testPrivateKey,
        testMints,
        testP2pkPubkey,
        testRelays
      )

      expect(result.isErr()).toBe(true)
    })
  })

  describe('publishRelayList', () => {
    it('should create and publish kind 10002 event', async () => {
      const result = await service.publishRelayList(
        testPrivateKey,
        testRelays,
        testRelays
      )

      expect(result.isOk()).toBe(true)
      expect(mockCreateKind10002Event).toHaveBeenCalledWith(
        testPrivateKey,
        testRelays
      )
      expect(mockPublish).toHaveBeenCalled()
    })
  })

  describe('publishToZSRelays', () => {
    it('should lookup ZS relays and publish both events', async () => {
      const zsDomain = 'zs.example.com'

      const result = await service.publishToZSRelays(
        testPrivateKey,
        zsDomain,
        testMints,
        testP2pkPubkey,
        testRelays
      )

      expect(result.isOk()).toBe(true)
      expect(mockLookupRelaysOnly).toHaveBeenCalledWith(zsDomain)
      // Should publish to ZS relays
      expect(mockPublish).toHaveBeenCalledWith(
        expect.any(Object),
        expect.arrayContaining(['wss://zs-relay1.com'])
      )
    })

    it('should return error if ZS lookup fails', async () => {
      mockLookupRelaysOnly.mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: { code: 'NIP05_LOOKUP_ERROR' },
      })

      const result = await service.publishToZSRelays(
        testPrivateKey,
        'bad-domain.com',
        testMints,
        testP2pkPubkey,
        testRelays
      )

      expect(result.isErr()).toBe(true)
    })

    it('should return error if no relays found', async () => {
      mockLookupRelaysOnly.mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: [],
      })

      const result = await service.publishToZSRelays(
        testPrivateKey,
        'empty-relays.com',
        testMints,
        testP2pkPubkey,
        testRelays
      )

      expect(result.isErr()).toBe(true)
    })
  })

  describe('updateProfile', () => {
    it('should update mints and republish', async () => {
      const newMints = ['https://newmint.com']

      const result = await service.updateProfile(testPrivateKey, {
        mints: newMints,
        p2pkPubkey: testP2pkPubkey,
        publishRelays: testRelays,
      })

      expect(result.isOk()).toBe(true)
      expect(mockCreateKind10019Event).toHaveBeenCalledWith(
        testPrivateKey,
        newMints,
        testP2pkPubkey,
        undefined
      )
    })

    it('should update relays and republish', async () => {
      const newRelays = ['wss://newrelay.com']

      const result = await service.updateProfile(testPrivateKey, {
        relays: newRelays,
        publishRelays: testRelays,
      })

      expect(result.isOk()).toBe(true)
      expect(mockCreateKind10002Event).toHaveBeenCalledWith(
        testPrivateKey,
        newRelays
      )
    })
  })
})
