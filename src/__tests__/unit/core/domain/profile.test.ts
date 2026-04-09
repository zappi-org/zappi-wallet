import { describe, it, expect } from 'vitest'
import {
  buildNutZapInfoEvent,
  buildRelayListEvent,
  buildDMRelayListEvent,
  parseRelayList,
  parseDMRelayList,
} from '@/core/domain/profile'
import type { NostrEvent } from '@/core/domain/nostr'

const PUBKEY = 'aabbccdd'

describe('buildNutZapInfoEvent', () => {
  it('builds kind:10019 with mints, pubkey, relays', () => {
    const event = buildNutZapInfoEvent(
      PUBKEY,
      ['https://mint-a.test', 'https://mint-b.test'],
      '02abc',
      ['wss://relay.test'],
    )

    expect(event.kind).toBe(10019)
    expect(event.pubkey).toBe(PUBKEY)
    expect(event.content).toBe('')
    expect(event.tags).toEqual([
      ['mint', 'https://mint-a.test', 'sat'],
      ['mint', 'https://mint-b.test', 'sat'],
      ['pubkey', '02abc'],
      ['relay', 'wss://relay.test'],
    ])
  })

  it('omits pubkey tag when not provided', () => {
    const event = buildNutZapInfoEvent(PUBKEY, ['https://mint.test'])

    const pubkeyTags = event.tags.filter((t) => t[0] === 'pubkey')
    expect(pubkeyTags).toHaveLength(0)
  })

  it('omits relay tags when not provided', () => {
    const event = buildNutZapInfoEvent(PUBKEY, ['https://mint.test'], '02abc')

    const relayTags = event.tags.filter((t) => t[0] === 'relay')
    expect(relayTags).toHaveLength(0)
  })
})

describe('buildRelayListEvent', () => {
  it('builds kind:10002 with r tags', () => {
    const event = buildRelayListEvent(PUBKEY, ['wss://r1.test', 'wss://r2.test'])

    expect(event.kind).toBe(10002)
    expect(event.tags).toEqual([
      ['r', 'wss://r1.test'],
      ['r', 'wss://r2.test'],
    ])
  })
})

describe('buildDMRelayListEvent', () => {
  it('builds kind:10050 with relay tags', () => {
    const event = buildDMRelayListEvent(PUBKEY, ['wss://dm1.test', 'wss://dm2.test'])

    expect(event.kind).toBe(10050)
    expect(event.tags).toEqual([
      ['relay', 'wss://dm1.test'],
      ['relay', 'wss://dm2.test'],
    ])
  })
})

function makeEvent(kind: number, tags: string[][]): NostrEvent {
  return { id: 'e1', pubkey: PUBKEY, created_at: 1000, kind, tags, content: '', sig: 'sig' }
}

describe('parseRelayList', () => {
  it('extracts relays from r tags', () => {
    const event = makeEvent(10002, [['r', 'wss://r1.test'], ['r', 'wss://r2.test']])
    expect(parseRelayList(event)).toEqual(['wss://r1.test', 'wss://r2.test'])
  })

  it('ignores non-r tags', () => {
    const event = makeEvent(10002, [['r', 'wss://r1.test'], ['other', 'value']])
    expect(parseRelayList(event)).toEqual(['wss://r1.test'])
  })

  it('returns empty array for no r tags', () => {
    const event = makeEvent(10002, [])
    expect(parseRelayList(event)).toEqual([])
  })
})

describe('parseDMRelayList', () => {
  it('extracts relays from relay tags', () => {
    const event = makeEvent(10050, [['relay', 'wss://dm1.test'], ['relay', 'wss://dm2.test']])
    expect(parseDMRelayList(event)).toEqual(['wss://dm1.test', 'wss://dm2.test'])
  })
})
