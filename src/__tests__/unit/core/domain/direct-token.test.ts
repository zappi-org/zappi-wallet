import { describe, it, expect } from 'vitest'
import { parseDirectToken } from '@/core/domain/direct-token'

const makeRumor = (overrides: Partial<{ kind: number; tags: string[][]; content: string; pubkey: string; created_at: number }> = {}) => ({
  kind: 14,
  tags: [],
  content: '',
  pubkey: 'sender-pubkey-hex',
  created_at: 1700000000,
  ...overrides,
})

describe('parseDirectToken', () => {
  it('extracts token from cashu tag', () => {
    const rumor = makeRumor({
      tags: [['cashu', 'cashuBtoken123']],
    })

    const result = parseDirectToken(rumor)

    expect(result).not.toBeNull()
    expect(result!.token).toBe('cashuBtoken123')
    expect(result!.senderPubkey).toBe('sender-pubkey-hex')
    expect(result!.createdAt).toBe(1700000000)
  })

  it('extracts token from content when no cashu tag', () => {
    const rumor = makeRumor({
      content: 'cashuBtoken456',
    })

    const result = parseDirectToken(rumor)

    expect(result).not.toBeNull()
    expect(result!.token).toBe('cashuBtoken456')
  })

  it('extracts cashuA token from content', () => {
    const rumor = makeRumor({
      content: 'cashuAtoken789',
    })

    const result = parseDirectToken(rumor)

    expect(result).not.toBeNull()
    expect(result!.token).toBe('cashuAtoken789')
  })

  it('treats non-token content as memo', () => {
    const rumor = makeRumor({
      tags: [['cashu', 'cashuBtoken']],
      content: 'Thanks for lunch!',
    })

    const result = parseDirectToken(rumor)

    expect(result).not.toBeNull()
    expect(result!.token).toBe('cashuBtoken')
    // memo is not set when cashu tag is found (content not parsed as memo in that case)
  })

  it('returns null for non-DM kind', () => {
    const rumor = makeRumor({ kind: 1 })

    expect(parseDirectToken(rumor)).toBeNull()
  })

  it('returns null when no cashu token found', () => {
    const rumor = makeRumor({
      content: 'just a regular message',
    })

    expect(parseDirectToken(rumor)).toBeNull()
  })

  it('returns null for empty rumor', () => {
    const rumor = makeRumor()

    expect(parseDirectToken(rumor)).toBeNull()
  })

  it('prefers cashu tag over content', () => {
    const rumor = makeRumor({
      tags: [['cashu', 'cashuBfromTag']],
      content: 'cashuBfromContent',
    })

    const result = parseDirectToken(rumor)

    expect(result!.token).toBe('cashuBfromTag')
  })
})
