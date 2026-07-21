import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileService } from '@/core/services/profile.service'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { SettingsRepository, WalletSettings } from '@/core/ports/driven/settings.repository.port'
import type { Nip05Resolver } from '@/core/ports/driven/nip05-resolver.port'
import type { NostrEvent } from '@/core/domain/nostr'

// ─── Fixtures ───

const PUBKEY = 'aabbccdd'

function makeEvent(kind: number, tags: string[][]): NostrEvent {
  return { id: 'e1', pubkey: PUBKEY, created_at: 1000, kind, tags, content: '', sig: 'sig' }
}

const DEFAULT_SETTINGS: WalletSettings = {
  mints: [],
  relays: [],
  autoLockTimeoutMinutes: 5,
  soundEnabled: true,
  expertModeEnabled: false,
  manualMintSelectionEnabled: false,
  balanceHidden: false,
}

// ─── Mocks ───

function createMocks() {
  const nostr: Pick<NostrGateway, 'publish' | 'queryEvents'> = {
    publish: vi.fn().mockResolvedValue({ id: 'e1', pubkey: PUBKEY, created_at: 1000, kind: 0, tags: [], content: '', sig: 'sig' }),
    queryEvents: vi.fn().mockResolvedValue([]),
  }

  const settings: Pick<SettingsRepository, 'getSettings' | 'saveSettings'> = {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  }

  const nip05: Nip05Resolver = {
    resolve: vi.fn().mockResolvedValue(null),
  }

  return { nostr, settings, nip05 }
}

// ─── Tests ───

describe('ProfileService', () => {
  let service: ProfileService
  let nostr: Pick<NostrGateway, 'publish' | 'queryEvents'>
  let settings: Pick<SettingsRepository, 'getSettings' | 'saveSettings'>
  let nip05: Nip05Resolver

  beforeEach(() => {
    const mocks = createMocks()
    nostr = mocks.nostr
    settings = mocks.settings
    nip05 = mocks.nip05
    service = new ProfileService(nostr, settings, nip05)
  })

  // ─── 발행 ───

  describe('publishNutZapInfo', () => {
    it('builds and publishes kind:10019', async () => {
      await service.publishNutZapInfo(PUBKEY, ['https://mint.test'], '02abc', ['wss://relay.test'])

      expect(nostr.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 10019,
          pubkey: PUBKEY,
        }),
      )
    })
  })

  describe('publishRelayList', () => {
    it('builds and publishes kind:10002', async () => {
      await service.publishRelayList(PUBKEY, ['wss://r1.test'])

      expect(nostr.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 10002,
          tags: [['r', 'wss://r1.test']],
        }),
      )
    })
  })

  describe('publishAll', () => {
    it('publishes 10019 + 10002 + 10050 in parallel', async () => {
      await service.publishAll(PUBKEY, ['https://mint.test'], ['wss://r.test'], '02abc')

      expect(nostr.publish).toHaveBeenCalledTimes(3)
    })
  })

  // ─── 조회 ───

  describe('fetchNutZapInfo', () => {
    it('returns parsed NutZapInfo', async () => {
      vi.mocked(nostr.queryEvents).mockResolvedValue([
        makeEvent(10019, [
          ['mint', 'https://mint.test', 'sat'],
          ['pubkey', '02abc'],
        ]),
      ])

      const result = await service.fetchNutZapInfo(PUBKEY)

      expect(result?.mints).toEqual(['https://mint.test'])
      expect(result?.p2pkPubkey).toBe('02abc')
    })

    it('returns undefined when no events', async () => {
      const result = await service.fetchNutZapInfo(PUBKEY)
      expect(result).toBeUndefined()
    })
  })

  describe('fetchRelayList', () => {
    it('returns parsed relay list', async () => {
      vi.mocked(nostr.queryEvents).mockResolvedValue([
        makeEvent(10002, [['r', 'wss://r1.test'], ['r', 'wss://r2.test']]),
      ])

      const result = await service.fetchRelayList(PUBKEY)
      expect(result).toEqual(['wss://r1.test', 'wss://r2.test'])
    })

    it('returns empty array when no events', async () => {
      const result = await service.fetchRelayList(PUBKEY)
      expect(result).toEqual([])
    })
  })

  // ─── 설정 저장 ───

  describe('saveProfileSettings', () => {
    it('merges mints/relays into existing settings', async () => {
      await service.saveProfileSettings(['https://mint.test'], ['wss://r.test'])

      expect(settings.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mints: ['https://mint.test'],
          relays: ['wss://r.test'],
        }),
      )
    })
  })

  // ─── ZS relay 조회 ───

  describe('resolveRelaysFromNip05', () => {
    it('returns relays from NIP-05', async () => {
      vi.mocked(nip05.resolve).mockResolvedValue({
        pubkey: PUBKEY,
        relays: ['wss://zs1.test', 'wss://zs2.test'],
      })

      const result = await service.resolveRelaysFromNip05('_@zap.si')
      expect(result).toEqual(['wss://zs1.test', 'wss://zs2.test'])
    })

    it('returns empty array when NIP-05 fails', async () => {
      const result = await service.resolveRelaysFromNip05('_@zap.si')
      expect(result).toEqual([])
    })
  })
})
