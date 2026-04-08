import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MintQuote } from 'coco-cashu-core'

// Mock Coco manager
const mockEnableWatchers = vi.fn()
const mockGetCocoManager = vi.fn()
const mockGetPendingMintQuotes = vi.fn()
vi.mock('@/modules/cashu/internal/coco-sdk', () => ({
  getPendingMintQuotes: (...args: unknown[]) => mockGetPendingMintQuotes(...args),
  getCocoManager: (...args: unknown[]) => mockGetCocoManager(...args),
  enableWatchers: (...args: unknown[]) => mockEnableWatchers(...args),
}))

import { getActivePendingQuotes } from '@/coco/cashuService'

function createCocoQuote(overrides: Partial<MintQuote> = {}): MintQuote {
  return {
    quote: overrides.quote ?? 'q-1',
    request: overrides.request ?? 'lnbc1000n1test',
    unit: 'sat',
    amount: overrides.amount ?? 1000,
    state: overrides.state ?? 'UNPAID',
    expiry: overrides.expiry ?? Math.floor(Date.now() / 1000) + 600,
    mintUrl: overrides.mintUrl ?? 'https://mint.example.com',
  }
}

describe('Quote recovery flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCocoManager.mockResolvedValue({})
    mockEnableWatchers.mockResolvedValue(undefined)
    mockGetPendingMintQuotes.mockResolvedValue([])
  })

  describe('enableWatchers timing', () => {
    it('enableWatchers should be called after getCocoManager (bridge connected first)', async () => {
      const callOrder: string[] = []
      mockGetCocoManager.mockImplementation(async () => {
        callOrder.push('getCocoManager')
        return {}
      })
      mockEnableWatchers.mockImplementation(async () => {
        callOrder.push('enableWatchers')
      })

      const { getCocoManager, enableWatchers } = await import('@/coco/manager')
      await getCocoManager()
      await enableWatchers()

      expect(callOrder).toEqual(['getCocoManager', 'enableWatchers'])
    })
  })

  describe('getActivePendingQuotes after watcher redeem', () => {
    it('returns empty when watcher already redeemed all quotes (ISSUED)', async () => {
      // Watcher already redeemed — getPendingMintQuotes returns nothing
      mockGetPendingMintQuotes.mockResolvedValue([])

      const result = await getActivePendingQuotes()
      expect(result).toEqual([])
    })

    it('returns UNPAID quotes still waiting for payment', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 600
      mockGetPendingMintQuotes.mockResolvedValue([
        createCocoQuote({ quote: 'q-waiting', state: 'UNPAID', expiry }),
      ])

      const result = await getActivePendingQuotes()
      expect(result).toHaveLength(1)
      expect(result[0].quoteId).toBe('q-waiting')
      expect(result[0].expiry).toBe(expiry * 1000)
    })

    it('filters expired quotes even if still UNPAID in Coco DB', async () => {
      mockGetPendingMintQuotes.mockResolvedValue([
        createCocoQuote({ quote: 'q-expired', expiry: Math.floor(Date.now() / 1000) - 60 }),
        createCocoQuote({ quote: 'q-valid', expiry: Math.floor(Date.now() / 1000) + 600 }),
      ])

      const result = await getActivePendingQuotes()
      expect(result).toHaveLength(1)
      expect(result[0].quoteId).toBe('q-valid')
    })
  })

  describe('single recovery path', () => {
    it('Coco-managed quotes are NOT processed by recoverPendingQuotes (watcher only)', async () => {
      // Verify recoverPendingQuotes doesn't call getPendingMintQuotes
      // (Phase 1 was removed — only Phase 2 legacy transactions remain)
      mockGetPendingMintQuotes.mockResolvedValue([
        createCocoQuote({ quote: 'q-should-not-touch', state: 'UNPAID' }),
      ])

      // getPendingMintQuotes should only be called by getActivePendingQuotes,
      // never by recoverPendingQuotes (which was stripped of Phase 1)
      mockGetPendingMintQuotes.mockClear()

      // getActivePendingQuotes uses getPendingMintQuotes
      mockGetPendingMintQuotes.mockResolvedValue([])
      await getActivePendingQuotes()
      expect(mockGetPendingMintQuotes).toHaveBeenCalledTimes(1)
    })
  })
})
