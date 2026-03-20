import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAppStore } from '@/store'

// Mock cross-tab sync
vi.mock('@/hooks/use-cross-tab-sync', () => ({
  broadcastSync: vi.fn(),
}))

// Mock i18n
vi.mock('@/i18n', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts)}` },
}))

// Mock format utils
vi.mock('@/utils/format', () => ({
  satUnit: () => 'sats',
}))

import { connectCocoToStore, disconnectCocoFromStore } from '@/coco/bridge'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'

type EventHandler = (payload: unknown) => void | Promise<void>

function createMockManager(balances: Record<string, number> = {}) {
  const handlers = new Map<string, EventHandler[]>()

  const manager = {
    wallet: {
      getBalances: vi.fn(async () => ({ ...balances })),
    },
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event)!.push(handler)
      return () => {
        const arr = handlers.get(event)
        if (arr) handlers.set(event, arr.filter((h) => h !== handler))
      }
    }),
  }

  const emit = async (event: string, payload: unknown) => {
    const arr = handlers.get(event) || []
    for (const h of arr) await h(payload)
  }

  return { manager, emit }
}

describe('Bridge: mint-quote:redeemed event', () => {
  beforeEach(() => {
    disconnectCocoFromStore()
    useAppStore.setState({
      balance: { total: 0, byMint: {} },
      pendingQuotes: [],
      toasts: [],
    })
    vi.clearAllMocks()
  })

  it('updates balance when mint-quote:redeemed fires', async () => {
    const { manager, emit } = createMockManager({ 'https://mint.example.com': 1000 })
    connectCocoToStore(manager as unknown as import('coco-cashu-core').Manager)

    // Wait for initial updateBalances()
    await vi.waitFor(() => {
      expect(useAppStore.getState().balance.total).toBe(1000)
    })

    // Simulate watcher redeeming a quote — balance increases
    manager.wallet.getBalances.mockResolvedValue({ 'https://mint.example.com': 2000 })

    await emit('mint-quote:redeemed', {
      mintUrl: 'https://mint.example.com',
      quoteId: 'q-paid-1',
      quote: { amount: 1000, request: 'lnbc1000n1test', quote: 'q-paid-1', unit: 'sat', state: 'ISSUED', expiry: 0 },
    })

    expect(useAppStore.getState().balance.total).toBe(2000)
    expect(useAppStore.getState().balance.byMint['https://mint.example.com']).toBe(2000)
  })

  it('removes pending quote from store', async () => {
    const { manager, emit } = createMockManager()
    connectCocoToStore(manager as unknown as import('coco-cashu-core').Manager)

    // Pre-populate pending quote
    useAppStore.getState().addPendingQuote({
      quoteId: 'q-paid-1',
      mintUrl: 'https://mint.example.com',
      amount: 1000,
      invoice: 'lnbc1000n1test',
      expiry: Date.now() + 600000,
    })
    expect(useAppStore.getState().pendingQuotes).toHaveLength(1)

    await emit('mint-quote:redeemed', {
      mintUrl: 'https://mint.example.com',
      quoteId: 'q-paid-1',
      quote: { amount: 1000, request: 'lnbc1000n1test', quote: 'q-paid-1', unit: 'sat', state: 'ISSUED', expiry: 0 },
    })

    expect(useAppStore.getState().pendingQuotes).toHaveLength(0)
  })

  it('shows toast notification', async () => {
    const { manager, emit } = createMockManager()
    connectCocoToStore(manager as unknown as import('coco-cashu-core').Manager)

    await emit('mint-quote:redeemed', {
      mintUrl: 'https://mint.example.com',
      quoteId: 'q-paid-1',
      quote: { amount: 500, request: 'lnbc500n1test', quote: 'q-paid-1', unit: 'sat', state: 'ISSUED', expiry: 0 },
    })

    const toasts = useAppStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('success')
  })

  it('broadcasts balance_changed sync', async () => {
    const { manager, emit } = createMockManager()
    connectCocoToStore(manager as unknown as import('coco-cashu-core').Manager)

    await emit('mint-quote:redeemed', {
      mintUrl: 'https://mint.example.com',
      quoteId: 'q-paid-1',
      quote: { amount: 1000, request: 'lnbc1000n1test', quote: 'q-paid-1', unit: 'sat', state: 'ISSUED', expiry: 0 },
    })

    expect(broadcastSync).toHaveBeenCalledWith('balance_changed')
  })

  it('updates balance on proofs:saved event', async () => {
    const { manager, emit } = createMockManager({ 'https://mint.example.com': 500 })
    connectCocoToStore(manager as unknown as import('coco-cashu-core').Manager)

    await vi.waitFor(() => {
      expect(useAppStore.getState().balance.total).toBe(500)
    })

    manager.wallet.getBalances.mockResolvedValue({ 'https://mint.example.com': 1500 })
    await emit('proofs:saved', {})

    await vi.waitFor(() => {
      expect(useAppStore.getState().balance.total).toBe(1500)
    })
  })
})
