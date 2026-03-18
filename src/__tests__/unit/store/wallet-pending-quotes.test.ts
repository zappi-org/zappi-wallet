import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import type { PendingQuote } from '@/store'

function createQuote(overrides: Partial<PendingQuote> = {}): PendingQuote {
  return {
    quoteId: overrides.quoteId ?? 'q-1',
    mintUrl: overrides.mintUrl ?? 'https://mint.example.com',
    amount: overrides.amount ?? 1000,
    invoice: overrides.invoice ?? 'lnbc1000n1test',
    expiry: overrides.expiry ?? Date.now() + 3600000,
  }
}

describe('wallet.slice pendingQuotes', () => {
  beforeEach(() => {
    useAppStore.setState({ pendingQuotes: [] })
  })

  it('addPendingQuote adds a quote to the store', () => {
    useAppStore.getState().addPendingQuote(createQuote())
    expect(useAppStore.getState().pendingQuotes).toHaveLength(1)
    expect(useAppStore.getState().pendingQuotes[0].quoteId).toBe('q-1')
  })

  it('addPendingQuote replaces existing quote with same quoteId', () => {
    useAppStore.getState().addPendingQuote(createQuote({ amount: 1000 }))
    useAppStore.getState().addPendingQuote(createQuote({ amount: 2000 }))
    expect(useAppStore.getState().pendingQuotes).toHaveLength(1)
    expect(useAppStore.getState().pendingQuotes[0].amount).toBe(2000)
  })

  it('removePendingQuote removes a quote by quoteId', () => {
    useAppStore.getState().addPendingQuote(createQuote({ quoteId: 'q-1' }))
    useAppStore.getState().addPendingQuote(createQuote({ quoteId: 'q-2' }))
    useAppStore.getState().removePendingQuote('q-1')
    expect(useAppStore.getState().pendingQuotes).toHaveLength(1)
    expect(useAppStore.getState().pendingQuotes[0].quoteId).toBe('q-2')
  })

  it('removePendingQuote does nothing for unknown quoteId', () => {
    useAppStore.getState().addPendingQuote(createQuote({ quoteId: 'q-1' }))
    useAppStore.getState().removePendingQuote('q-999')
    expect(useAppStore.getState().pendingQuotes).toHaveLength(1)
  })
})
