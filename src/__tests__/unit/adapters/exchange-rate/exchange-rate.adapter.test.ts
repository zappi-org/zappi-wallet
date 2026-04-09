import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExchangeRateAdapter } from '@/adapters/exchange-rate/exchange-rate.adapter'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockCoinbaseResponse(rates: Record<string, string>) {
  return {
    ok: true,
    json: async () => ({ data: { currency: 'BTC', rates } }),
  }
}

function mockUpbitResponse(price: number) {
  return {
    ok: true,
    json: async () => [{ market: 'KRW-BTC', trade_price: price }],
  }
}

describe('ExchangeRateAdapter', () => {
  let adapter: ExchangeRateAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new ExchangeRateAdapter()
  })

  describe('fetchRates', () => {
    it('fetches from Coinbase + Upbit and returns rates', async () => {
      mockFetch
        .mockResolvedValueOnce(mockCoinbaseResponse({ USD: '95000', EUR: '87000', KRW: '129000000' }))
        .mockResolvedValueOnce(mockUpbitResponse(130000000))

      const result = await adapter.fetchRates()

      expect(result).not.toBeNull()
      expect(result!.rates['USD']).toBe(95000)
      expect(result!.rates['EUR']).toBe(87000)
      expect(result!.rates['KRW']).toBe(130000000) // Upbit override
      expect(result!.fetchedAt).toBeGreaterThan(0)
    })

    it('uses Coinbase KRW when Upbit fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockCoinbaseResponse({ USD: '95000', KRW: '129000000' }))
        .mockResolvedValueOnce({ ok: false })

      const result = await adapter.fetchRates()

      expect(result!.rates['KRW']).toBe(129000000) // Coinbase fallback
    })

    it('returns null when Coinbase fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce(mockUpbitResponse(130000000))

      const result = await adapter.fetchRates()
      expect(result).toBeNull()
    })

    it('filters unsupported currencies', async () => {
      mockFetch
        .mockResolvedValueOnce(mockCoinbaseResponse({ USD: '95000', DOGE: '999999' }))
        .mockResolvedValueOnce({ ok: false })

      const result = await adapter.fetchRates()

      expect(result!.rates['USD']).toBe(95000)
      expect(result!.rates['DOGE']).toBeUndefined()
    })

    it('throttles repeated calls', async () => {
      mockFetch
        .mockResolvedValueOnce(mockCoinbaseResponse({ USD: '95000' }))
        .mockResolvedValueOnce(mockUpbitResponse(130000000))

      await adapter.fetchRates()
      await adapter.fetchRates() // should be throttled

      expect(mockFetch).toHaveBeenCalledTimes(2) // only first call (coinbase + upbit)
    })
  })

  describe('getRate', () => {
    it('returns rate for specific currency', async () => {
      mockFetch
        .mockResolvedValueOnce(mockCoinbaseResponse({ USD: '95000', EUR: '87000' }))
        .mockResolvedValueOnce(mockUpbitResponse(130000000))

      const rate = await adapter.getRate('USD')
      expect(rate).toBe(95000)
    })

    it('returns null for unknown currency', async () => {
      mockFetch
        .mockResolvedValueOnce(mockCoinbaseResponse({ USD: '95000' }))
        .mockResolvedValueOnce({ ok: false })

      const rate = await adapter.getRate('EUR')
      expect(rate).toBeNull()
    })

    it('returns null when fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('network'))

      const rate = await adapter.getRate('USD')
      expect(rate).toBeNull()
    })
  })
})
