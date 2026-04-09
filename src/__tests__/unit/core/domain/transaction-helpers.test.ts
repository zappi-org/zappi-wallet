import { describe, it, expect } from 'vitest'
import { getTransactionType, getTxMeta } from '@/core/domain/transaction'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    direction: 'send',
    method: 'cashu:lightning',
    protocol: 'bolt11',
    amount: sat(1000),
    accountId: 'https://mint.example.com',
    status: 'settled',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('getTransactionType', () => {
  it('returns lightning for bolt11 protocol', () => {
    expect(getTransactionType(makeTx({ protocol: 'bolt11' }))).toBe('lightning')
  })

  it('returns ecash for nut18 protocol', () => {
    expect(getTransactionType(makeTx({ method: 'cashu:ecash', protocol: 'nut18' }))).toBe('ecash')
  })

  it('returns ecash-token for cashu-token protocol', () => {
    expect(getTransactionType(makeTx({ method: 'cashu:ecash', protocol: 'cashu-token' }))).toBe('ecash-token')
  })

  it('returns nutzap for cashu-token with nutzap intent', () => {
    expect(getTransactionType(makeTx({ method: 'cashu:ecash', protocol: 'cashu-token', intent: 'nutzap' }))).toBe('nutzap')
  })

  it('returns swap when intent is swap', () => {
    expect(getTransactionType(makeTx({ intent: 'swap' }))).toBe('swap')
  })

  it('returns lightning as fallback', () => {
    expect(getTransactionType(makeTx({ method: 'unknown', protocol: 'unknown' }))).toBe('lightning')
  })
})

describe('getTxMeta', () => {
  it('extracts metadata fields', () => {
    const tx = makeTx({
      metadata: {
        token: 'cashuAtoken123',
        bolt11: 'lnbc1...',
        preimage: 'abc123',
        operationId: 'op1',
        tokenState: 'unspent',
        source: 'zappi-pos',
        fromMintUrl: 'https://mint-a.com',
        toMintUrl: 'https://mint-b.com',
        fee: 5,
        reclaimedFrom: 'tx2',
        destination: 'user@ln.address',
      },
    })

    const meta = getTxMeta(tx)
    expect(meta.token).toBe('cashuAtoken123')
    expect(meta.bolt11).toBe('lnbc1...')
    expect(meta.preimage).toBe('abc123')
    expect(meta.operationId).toBe('op1')
    expect(meta.tokenState).toBe('unspent')
    expect(meta.source).toBe('zappi-pos')
    expect(meta.fromMintUrl).toBe('https://mint-a.com')
    expect(meta.toMintUrl).toBe('https://mint-b.com')
    expect(meta.fee).toBe(5)
    expect(meta.reclaimedFrom).toBe('tx2')
    expect(meta.destination).toBe('user@ln.address')
  })

  it('returns undefined for missing metadata', () => {
    const tx = makeTx({ metadata: undefined })
    const meta = getTxMeta(tx)
    expect(meta.token).toBeUndefined()
    expect(meta.bolt11).toBeUndefined()
    expect(meta.fee).toBeUndefined()
  })

  it('returns undefined for empty metadata', () => {
    const tx = makeTx({ metadata: {} })
    const meta = getTxMeta(tx)
    expect(meta.source).toBeUndefined()
  })
})
