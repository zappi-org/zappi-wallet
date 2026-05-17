import { vi } from 'vitest'
import type { Proof, MintQuoteState, MeltQuoteState } from '@cashu/cashu-ts'

/**
 * Mock proof factory
 */
export function createMockProof(overrides: Partial<Proof> = {}): Proof {
  return {
    id: overrides.id ?? 'mock-keyset-id',
    amount: overrides.amount ?? 100,
    secret: overrides.secret ?? 'mock-secret-' + Math.random().toString(36).slice(2),
    C: overrides.C ?? 'mock-C-value',
    ...overrides,
  }
}

/**
 * Mock proofs array
 */
export function createMockProofs(amounts: number[]): Proof[] {
  return amounts.map((amount) => createMockProof({ amount }))
}

/**
 * Mock mint quote
 */
export function createMockMintQuote(overrides: Partial<{
  quote: string
  request: string
  state: MintQuoteState
  expiry: number
}> = {}) {
  return {
    quote: overrides.quote ?? 'mock-quote-id-' + Math.random().toString(36).slice(2),
    request: overrides.request ?? 'lnbc1000n1...',
    state: overrides.state ?? 'UNPAID' as MintQuoteState,
    expiry: overrides.expiry ?? Math.floor(Date.now() / 1000) + 3600,
  }
}

/**
 * Mock melt quote
 */
export function createMockMeltQuote(overrides: Partial<{
  quote: string
  amount: number
  fee_reserve: number
  state: MeltQuoteState
  expiry: number
  payment_preimage: string | null
}> = {}) {
  return {
    quote: overrides.quote ?? 'mock-melt-quote-' + Math.random().toString(36).slice(2),
    amount: overrides.amount ?? 1000,
    fee_reserve: overrides.fee_reserve ?? 10,
    state: overrides.state ?? 'UNPAID' as MeltQuoteState,
    expiry: overrides.expiry ?? Math.floor(Date.now() / 1000) + 3600,
    payment_preimage: overrides.payment_preimage ?? null,
  }
}

/**
 * Mock Wallet
 */
export function createMockWallet() {
  return {
    mint: {
      mintUrl: 'https://mock-mint.example.com',
      getInfo: vi.fn().mockResolvedValue({
        name: 'Mock Mint',
        pubkey: 'mock-pubkey',
        version: '0.15.0',
      }),
    },
    createMintQuote: vi.fn().mockResolvedValue(createMockMintQuote()),
    checkMintQuote: vi.fn().mockResolvedValue(createMockMintQuote({ state: 'PAID' })),
    mintProofs: vi.fn().mockResolvedValue(createMockProofs([64, 32, 4])),
    createMeltQuote: vi.fn().mockResolvedValue(createMockMeltQuote()),
    melt: vi.fn().mockResolvedValue({
      quote: createMockMeltQuote({ state: 'PAID' }),
      change: [],
    }),
    receive: vi.fn().mockResolvedValue(createMockProofs([100])),
    send: vi.fn().mockResolvedValue({
      keep: createMockProofs([50]),
      send: createMockProofs([50]),
    }),
    getBalance: vi.fn().mockReturnValue(1000),
  }
}

/**
 * Mock cashu-ts module
 */
export const mockCashuTs = {
  Wallet: vi.fn().mockImplementation(() => createMockWallet()),
  Mint: vi.fn().mockImplementation((mintUrl: string) => ({
    mintUrl,
    getInfo: vi.fn().mockResolvedValue({
      name: 'Mock Mint',
      pubkey: 'mock-pubkey',
    }),
    getKeys: vi.fn().mockResolvedValue([]),
    getKeySets: vi.fn().mockResolvedValue([]),
  })),
  getEncodedToken: vi.fn().mockReturnValue('cashuBmock...'),
  getDecodedToken: vi.fn().mockReturnValue({
    token: [{ mint: 'https://mock-mint.example.com', proofs: createMockProofs([100]) }],
    unit: 'sat',
  }),
  PaymentRequest: vi.fn().mockImplementation(() => ({
    toEncodedCreqA: () => 'creqAmock...',
    toEncodedCreqB: () => 'CREQB1MOCK...',
  })),
  PaymentRequestTransportType: {
    NOSTR: 0,
    POST: 1,
  },
}
