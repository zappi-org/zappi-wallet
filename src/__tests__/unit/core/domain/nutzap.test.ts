import { describe, it, expect } from 'vitest'
import { parseNutZapInfo } from '@/core/domain/nutzap'
import type { NostrEvent } from '@/core/domain/nostr'

function makeEvent(tags: string[][]): NostrEvent {
  return { id: 'e1', pubkey: 'pk', created_at: 1000, kind: 10019, tags, content: '', sig: 'sig' }
}

describe('parseNutZapInfo', () => {
  it('parses mints, p2pkPubkey, relays', () => {
    const event = makeEvent([
      ['mint', 'https://mint-a.test', 'sat'],
      ['mint', 'https://mint-b.test', 'sat'],
      ['pubkey', '02abc...'],
      ['relay', 'wss://relay1.test'],
      ['relay', 'wss://relay2.test'],
    ])

    const result = parseNutZapInfo(event)

    expect(result.mints).toEqual(['https://mint-a.test', 'https://mint-b.test'])
    expect(result.p2pkPubkey).toBe('02abc...')
    expect(result.relays).toEqual(['wss://relay1.test', 'wss://relay2.test'])
  })

  it('accepts mint tag without unit (2-element tag)', () => {
    const event = makeEvent([
      ['mint', 'https://mint.test'],
    ])

    const result = parseNutZapInfo(event)
    expect(result.mints).toEqual(['https://mint.test'])
  })

  it('filters mints by unit', () => {
    const event = makeEvent([
      ['mint', 'https://sat-mint.test', 'sat'],
      ['mint', 'https://usd-mint.test', 'usd'],
    ])

    const result = parseNutZapInfo(event, 'sat')
    expect(result.mints).toEqual(['https://sat-mint.test'])
  })

  it('returns undefined relays when no relay tags', () => {
    const event = makeEvent([
      ['mint', 'https://mint.test'],
      ['pubkey', '02abc...'],
    ])

    const result = parseNutZapInfo(event)
    expect(result.relays).toBeUndefined()
  })

  it('returns undefined p2pkPubkey when no pubkey tag', () => {
    const event = makeEvent([
      ['mint', 'https://mint.test'],
    ])

    const result = parseNutZapInfo(event)
    expect(result.p2pkPubkey).toBeUndefined()
  })

  it('handles empty tags', () => {
    const event = makeEvent([])

    const result = parseNutZapInfo(event)
    expect(result.mints).toEqual([])
    expect(result.p2pkPubkey).toBeUndefined()
    expect(result.relays).toBeUndefined()
  })

  it('ignores unknown tags', () => {
    const event = makeEvent([
      ['mint', 'https://mint.test'],
      ['unknown', 'value'],
      ['pubkey', '02abc...'],
    ])

    const result = parseNutZapInfo(event)
    expect(result.mints).toHaveLength(1)
    expect(result.p2pkPubkey).toBe('02abc...')
  })
})
