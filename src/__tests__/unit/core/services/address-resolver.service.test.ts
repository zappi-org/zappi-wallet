import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddressResolverService } from '@/core/services/address-resolver.service'
import type { Nip05Resolver } from '@/core/ports/driven/nip05-resolver.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { LnurlGateway, LnurlPayParams } from '@/core/ports/driven/lnurl-gateway.port'
import type { NostrEvent } from '@/core/domain/nostr'

// ─── Fixtures ───

const PUBKEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const NPUB = 'npub15xev848976sm9s75uhm2rvkr6njldgdjc02wta4pktpafe0k5xeqd3u8ss'
const NPROFILE = 'nprofile1qyg8wumn8ghj7un9d3shjtn5v4ehgqg3waehxw309aex2mrp0yezuar9wd6qqg9pktpafe0k5xev848976sm9s75uhm2rvkr6njldgdjc02wta4pkg9nq5cp'

const LNURL_PAY: LnurlPayParams = {
  callback: 'https://pay.test/cb',
  minSendable: 1000,
  maxSendable: 1_000_000_000,
  metadata: '[]',
  tag: 'payRequest',
  domain: 'pay.test',
}

function makeK10019(pubkey: string): NostrEvent {
  return {
    id: 'e1', pubkey, created_at: 1000, kind: 10019, sig: 'sig',
    content: '',
    tags: [
      ['mint', 'https://mint-a.test', 'sat'],
      ['mint', 'https://mint-b.test', 'sat'],
      ['pubkey', '02abc123'],
      ['relay', 'wss://relay.test'],
    ],
  }
}

function makeK10050(pubkey: string): NostrEvent {
  return {
    id: 'e2', pubkey, created_at: 1001, kind: 10050, sig: 'sig',
    content: '',
    tags: [
      ['relay', 'wss://dm1.test'],
      ['relay', 'wss://dm2.test'],
    ],
  }
}

function mockEventsByKind(
  nostr: Pick<NostrGateway, 'queryEvents'>,
  eventsByKind: Record<number, NostrEvent[]>,
) {
  vi.mocked(nostr.queryEvents).mockImplementation(async (filters) => {
    const kind = filters[0]?.kinds?.[0]
    return kind ? eventsByKind[kind] ?? [] : []
  })
}

// ─── Mocks ───

function createMocks() {
  const nip05: Nip05Resolver = {
    resolve: vi.fn().mockResolvedValue(null),
  }
  const nostr: Pick<NostrGateway, 'queryEvents'> = {
    queryEvents: vi.fn().mockResolvedValue([]),
  }
  const lnurl: Pick<LnurlGateway, 'resolvePay'> = {
    resolvePay: vi.fn().mockRejectedValue(new Error('not found')),
  }
  return { nip05, nostr, lnurl }
}

// ─── Tests ───

describe('AddressResolverService', () => {
  let service: AddressResolverService
  let nip05: Nip05Resolver
  let nostr: Pick<NostrGateway, 'queryEvents'>
  let lnurl: Pick<LnurlGateway, 'resolvePay'>

  beforeEach(() => {
    const mocks = createMocks()
    nip05 = mocks.nip05
    nostr = mocks.nostr
    lnurl = mocks.lnurl
    service = new AddressResolverService(nip05, nostr, lnurl)
  })

  // ─── email ───

  describe('email', () => {
    it('resolves with nip05 + k10019 + lnurl', async () => {
      vi.mocked(nip05.resolve).mockResolvedValue({
        pubkey: PUBKEY,
        relays: ['wss://relay.test'],
      })
      mockEventsByKind(nostr, {
        10019: [makeK10019(PUBKEY)],
        10050: [makeK10050(PUBKEY)],
      })
      vi.mocked(lnurl.resolvePay).mockResolvedValue(LNURL_PAY)

      const result = await service.resolve('alice@domain.test')

      expect(result.type).toBe('email')
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.relays).toEqual(['wss://relay.test'])
      expect(result.capabilities.directToken?.mints).toEqual(['https://mint-a.test', 'https://mint-b.test'])
      expect(result.capabilities.directToken?.p2pkPubkey).toBe('02abc123')
      expect(result.capabilities.directToken?.dmRelays).toEqual(['wss://dm1.test', 'wss://dm2.test'])
      expect(result.capabilities.lnurl).toEqual(LNURL_PAY)
    })

    it('resolves lnurl-only when nip05 fails', async () => {
      vi.mocked(nip05.resolve).mockResolvedValue(null)
      vi.mocked(lnurl.resolvePay).mockResolvedValue(LNURL_PAY)

      const result = await service.resolve('bob@domain.test')

      expect(result.type).toBe('email')
      expect(result.pubkey).toBeUndefined()
      expect(result.capabilities.lnurl).toEqual(LNURL_PAY)
      expect(result.capabilities.directToken).toBeUndefined()
    })

    it('returns empty capabilities when nothing resolves', async () => {
      const result = await service.resolve('nobody@domain.test')

      expect(result.type).toBe('email')
      expect(result.capabilities).toEqual({})
    })

    it('omits directToken when no k10019 event', async () => {
      vi.mocked(nip05.resolve).mockResolvedValue({ pubkey: PUBKEY, relays: [] })
      vi.mocked(nostr.queryEvents).mockResolvedValue([])

      const result = await service.resolve('alice@domain.test')

      expect(result.capabilities.directToken).toBeUndefined()
    })
  })

  // ─── npub ───

  describe('npub', () => {
    it('resolves with k10019', async () => {
      mockEventsByKind(nostr, {
        10019: [makeK10019(PUBKEY)],
        10050: [makeK10050(PUBKEY)],
      })

      const result = await service.resolve(NPUB)

      expect(result.type).toBe('npub')
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.capabilities.directToken?.mints).toHaveLength(2)
      expect(result.capabilities.directToken?.dmRelays).toEqual(['wss://dm1.test', 'wss://dm2.test'])
      expect(result.capabilities.lnurl).toBeUndefined()
    })

    it('does not use k10019 relay tags as DM relays', async () => {
      mockEventsByKind(nostr, {
        10019: [makeK10019(PUBKEY)],
      })

      const result = await service.resolve(NPUB)

      expect(result.capabilities.directToken?.mints).toHaveLength(2)
      expect(result.capabilities.directToken?.dmRelays).toBeUndefined()
    })

    it('returns empty capabilities when no k10019', async () => {
      const result = await service.resolve(NPUB)

      expect(result.type).toBe('npub')
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.capabilities).toEqual({})
    })
  })

  // ─── nprofile ───

  describe('nprofile', () => {
    it('resolves with relays and k10019', async () => {
      mockEventsByKind(nostr, {
        10019: [makeK10019(PUBKEY)],
        10050: [makeK10050(PUBKEY)],
      })

      const result = await service.resolve(NPROFILE)

      expect(result.type).toBe('nprofile')
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.relays).toEqual(['wss://relay.test', 'wss://relay2.test'])
      expect(result.capabilities.directToken).toBeDefined()
      expect(result.capabilities.directToken?.dmRelays).toEqual(['wss://dm1.test', 'wss://dm2.test'])
    })
  })

  // ─── bolt12 ───

  describe('bolt12', () => {
    it('returns offer as-is', async () => {
      const offer = 'lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcsjq'

      const result = await service.resolve(offer)

      expect(result.type).toBe('bolt12')
      expect(result.capabilities.bolt12?.offer).toBe(offer)
    })
  })

  // ─── unknown ───

  describe('unknown address', () => {
    it('throws on unrecognized format', async () => {
      await expect(service.resolve('invalid')).rejects.toThrow('Unknown address type')
    })
  })
})
