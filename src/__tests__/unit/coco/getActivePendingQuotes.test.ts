import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MintQuote } from 'coco-cashu-core'

// Mock Coco manager
vi.mock('@/coco/manager', () => ({
  getPendingMintQuotes: vi.fn(),
}))

import { getPendingMintQuotes } from '@/coco/manager'
import { getActivePendingQuotes } from '@/coco/cashuService'

const mockGetPendingMintQuotes = vi.mocked(getPendingMintQuotes)

function createCocoQuote(overrides: Partial<MintQuote> = {}): MintQuote {
  return {
    quote: overrides.quote ?? 'q-1',
    request: overrides.request ?? 'lnbc1000n1test',
    unit: 'sat',
    amount: overrides.amount ?? 1000,
    state: overrides.state ?? 'UNPAID',
    expiry: overrides.expiry ?? Math.floor(Date.now() / 1000) + 600, // 10 min from now
    mintUrl: overrides.mintUrl ?? 'https://mint.example.com',
  }
}

describe('getActivePendingQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no pending quotes', async () => {
    mockGetPendingMintQuotes.mockResolvedValue([])
    const result = await getActivePendingQuotes()
    expect(result).toEqual([])
  })

  it('filters out expired quotes', async () => {
    mockGetPendingMintQuotes.mockResolvedValue([
      createCocoQuote({ quote: 'expired', expiry: Math.floor(Date.now() / 1000) - 60 }),
      createCocoQuote({ quote: 'valid', expiry: Math.floor(Date.now() / 1000) + 600 }),
    ])

    const result = await getActivePendingQuotes()
    expect(result).toHaveLength(1)
    expect(result[0].quoteId).toBe('valid')
  })

  it('includes quotes without expiry', async () => {
    mockGetPendingMintQuotes.mockResolvedValue([
      createCocoQuote({ quote: 'no-expiry', expiry: 0 }),
    ])

    const result = await getActivePendingQuotes()
    expect(result).toHaveLength(1)
    expect(result[0].quoteId).toBe('no-expiry')
  })

  it('maps Coco MintQuote fields to PendingQuote correctly', async () => {
    const expirySeconds = Math.floor(Date.now() / 1000) + 600
    mockGetPendingMintQuotes.mockResolvedValue([
      createCocoQuote({
        quote: 'q-123',
        request: 'lnbc500n1invoice',
        amount: 500,
        mintUrl: 'https://testmint.com',
        expiry: expirySeconds,
      }),
    ])

    const result = await getActivePendingQuotes()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      quoteId: 'q-123',
      mintUrl: 'https://testmint.com',
      amount: 500,
      invoice: 'lnbc500n1invoice',
      expiry: expirySeconds * 1000,
    })
  })

  it('returns all valid quotes from multiple mints', async () => {
    mockGetPendingMintQuotes.mockResolvedValue([
      createCocoQuote({ quote: 'q-1', mintUrl: 'https://mint1.com' }),
      createCocoQuote({ quote: 'q-2', mintUrl: 'https://mint2.com' }),
      createCocoQuote({ quote: 'q-3', mintUrl: 'https://mint1.com' }),
    ])

    const result = await getActivePendingQuotes()
    expect(result).toHaveLength(3)
  })
})
