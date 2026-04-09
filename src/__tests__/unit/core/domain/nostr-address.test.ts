import { describe, it, expect } from 'vitest'
import { npubDecode, nprofileDecode } from '@/core/domain/nostr-address'

describe('npubDecode', () => {
  it('decodes npub to hex pubkey', () => {
    const npub = 'npub15xev848976sm9s75uhm2rvkr6njldgdjc02wta4pktpafe0k5xeqd3u8ss'
    const pubkey = npubDecode(npub)
    expect(pubkey).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')
  })

  it('throws on wrong prefix', () => {
    expect(() => npubDecode('nsec1abc')).toThrow()
  })

  it('throws on invalid checksum', () => {
    const bad = 'npub15xev848976sm9s75uhm2rvkr6njldgdjc02wta4pktpafe0k5xeqd3u8sx'
    expect(() => npubDecode(bad)).toThrow()
  })
})

describe('nprofileDecode', () => {
  const pubkey = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

  it('decodes nprofile without relays', () => {
    const nprofile = 'nprofile1qqs2rvkr6njldgdjc02wta4pktpafe0k5xev848976sm9s75uhm2rvs6v8skw'
    const result = nprofileDecode(nprofile)
    expect(result.pubkey).toBe(pubkey)
    expect(result.relays).toBeUndefined()
  })

  it('decodes nprofile with relays', () => {
    const nprofile = 'nprofile1qyg8wumn8ghj7un9d3shjtn5v4ehgqg3waehxw309aex2mrp0yezuar9wd6qqg9pktpafe0k5xev848976sm9s75uhm2rvkr6njldgdjc02wta4pkg9nq5cp'
    const result = nprofileDecode(nprofile)
    expect(result.pubkey).toBe(pubkey)
    expect(result.relays).toEqual(['wss://relay.test', 'wss://relay2.test'])
  })

  it('throws on wrong prefix', () => {
    expect(() => nprofileDecode('npub1abc')).toThrow()
  })
})
