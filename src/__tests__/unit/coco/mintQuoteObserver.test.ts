import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock database
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    transactions: {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    },
  }
  return { mockDb }
})

vi.mock('@/data/database/schema', () => ({
  getDatabase: () => mockDb,
}))

// Mock store
const mockTriggerTxRefresh = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      triggerTxRefresh: mockTriggerTxRefresh,
    }),
  },
}))

// Mock cross-tab sync
vi.mock('@/hooks/use-cross-tab-sync', () => ({
  broadcastSync: vi.fn(),
}))

// Mock bridge (isSwapQuote, unmarkQuoteAsSwap)
const mockIsSwapQuote = vi.fn().mockReturnValue(false)
const mockUnmarkQuoteAsSwap = vi.fn()
vi.mock('@/coco/bridge', () => ({
  isSwapQuote: (...args: unknown[]) => mockIsSwapQuote(...args),
  unmarkQuoteAsSwap: (...args: unknown[]) => mockUnmarkQuoteAsSwap(...args),
}))

import { recordLightningReceive, connectMintQuoteObserver, disconnectMintQuoteObserver } from '@/coco/mintQuoteObserver'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'
import type { Manager } from 'coco-cashu-core'

describe('mintQuoteObserver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.transactions.get.mockResolvedValue(undefined)
    mockIsSwapQuote.mockReturnValue(false)
    disconnectMintQuoteObserver()
  })

  describe('recordLightningReceive', () => {
    it('records transaction to DB', async () => {
      const recorded = await recordLightningReceive({
        quoteId: 'q-1',
        mintUrl: 'https://mint.example.com',
        amount: 1000,
        bolt11: 'lnbc1000n1test',
      })

      expect(recorded).toBe(true)
      expect(mockDb.transactions.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tx-q-1',
          direction: 'receive',
          type: 'lightning',
          amount: 1000,
          mintUrl: 'https://mint.example.com',
          status: 'completed',
          bolt11: 'lnbc1000n1test',
          metadata: { quoteId: 'q-1' },
        })
      )
    })

    it('skips if transaction already exists (idempotent)', async () => {
      mockDb.transactions.get.mockResolvedValueOnce({ id: 'tx-q-1', status: 'completed' })

      const recorded = await recordLightningReceive({
        quoteId: 'q-1',
        mintUrl: 'https://mint.example.com',
        amount: 1000,
      })

      expect(recorded).toBe(false)
      expect(mockDb.transactions.put).not.toHaveBeenCalled()
    })

    it('triggers UI refresh and broadcasts sync', async () => {
      await recordLightningReceive({
        quoteId: 'q-1',
        mintUrl: 'https://mint.example.com',
        amount: 1000,
      })

      expect(mockTriggerTxRefresh).toHaveBeenCalled()
      expect(broadcastSync).toHaveBeenCalledWith('balance_changed')
    })
  })

  describe('connectMintQuoteObserver', () => {
    it('records transaction on mint-op:finalized event', async () => {
      type EventHandler = (payload: unknown) => void | Promise<void>
      const handlers = new Map<string, EventHandler[]>()

      const manager = {
        on: vi.fn((event: string, handler: EventHandler) => {
          if (!handlers.has(event)) handlers.set(event, [])
          handlers.get(event)!.push(handler)
          return () => {}
        }),
      }

      connectMintQuoteObserver(manager as unknown as Manager)

      // Emit event
      const eventHandlers = handlers.get('mint-op:finalized') || []
      for (const h of eventHandlers) {
        await h({
          mintUrl: 'https://mint.example.com',
          operationId: 'op-2',
          operation: { state: 'finalized', quoteId: 'q-2', amount: 500, request: 'lnbc500n1test', expiry: 0, mintUrl: 'https://mint.example.com' },
        })
      }

      expect(mockDb.transactions.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tx-q-2',
          amount: 500,
          bolt11: 'lnbc500n1test',
        })
      )
    })

    it('skips swap quotes', async () => {
      mockIsSwapQuote.mockReturnValue(true)

      type EventHandler = (payload: unknown) => void | Promise<void>
      const handlers = new Map<string, EventHandler[]>()

      const manager = {
        on: vi.fn((event: string, handler: EventHandler) => {
          if (!handlers.has(event)) handlers.set(event, [])
          handlers.get(event)!.push(handler)
          return () => {}
        }),
      }

      connectMintQuoteObserver(manager as unknown as Manager)

      const eventHandlers = handlers.get('mint-op:finalized') || []
      for (const h of eventHandlers) {
        await h({
          mintUrl: 'https://mint.example.com',
          operationId: 'op-swap-1',
          operation: { state: 'finalized', quoteId: 'swap-q-1', amount: 1000, request: 'lnbc1000n1test', expiry: 0, mintUrl: 'https://mint.example.com' },
        })
      }

      expect(mockDb.transactions.put).not.toHaveBeenCalled()
      expect(mockUnmarkQuoteAsSwap).toHaveBeenCalledWith('swap-q-1')
    })
  })
})
