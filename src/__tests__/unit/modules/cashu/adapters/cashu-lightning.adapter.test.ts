import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CashuLightningAdapter,
  type LightningBackend,
} from '@/modules/cashu/adapters/cashu-lightning.adapter'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Mock Backend ───

function createMockBackend(): LightningBackend {
  return {
    prepareMelt: vi.fn().mockResolvedValue({
      operationId: 'melt-op-1',
      quoteId: 'quote-1',
      amount: 1000,
      fee_reserve: 3,
      swap_fee: 1,
    }),
    executeMelt: vi.fn().mockResolvedValue({ state: 'finalized' }),
    rollbackMelt: vi.fn().mockResolvedValue(undefined),
    createMintQuote: vi.fn().mockResolvedValue({
      quote: 'mint-quote-1',
      request: 'lnbc1000n1...',
      expiry: Math.floor(Date.now() / 1000) + 600,
    }),
    redeemMintQuote: vi.fn().mockResolvedValue(undefined),
    recoverPendingMelts: vi.fn().mockResolvedValue({ recovered: 2, failed: 0 }),
  }
}

describe('CashuLightningAdapter', () => {
  let adapter: CashuLightningAdapter
  let backend: LightningBackend

  beforeEach(() => {
    backend = createMockBackend()
    adapter = new CashuLightningAdapter(backend)
  })

  // ─── Identity ───

  it('has correct id and capabilities', () => {
    expect(adapter.id).toBe('cashu:lightning')
    expect(adapter.moduleId).toBe('cashu')
    expect(adapter.capabilities.canSend).toBe(true)
    expect(adapter.capabilities.canReceive).toBe(true)
    expect(adapter.capabilities.canEstimateFee).toBe(true)
  })

  // ─── createReceiveRequest ───

  describe('createReceiveRequest', () => {
    it('creates mint quote and returns receive request', async () => {
      const result = await adapter.createReceiveRequest({
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      expect(backend.createMintQuote).toHaveBeenCalledWith('https://mint.test', 1000)
      expect(result.id).toBe('mint-quote-1')
      expect(result.method).toBe('lightning')
      expect(result.protocol).toBe('bolt11')
      expect(result.encoded).toBe('lnbc1000n1...')
      expect(toNumber(result.amount)).toBe(1000)
      expect(result.expiresAt).toBeGreaterThan(Date.now())
    })
  })

  // ─── estimateFee ───

  describe('estimateFee', () => {
    it('returns fee from prepare → rollback pattern', async () => {
      const result = await adapter.estimateFee({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      expect(backend.prepareMelt).toHaveBeenCalledWith('https://mint.test', 'lnbc1000n1...')
      expect(backend.rollbackMelt).toHaveBeenCalledWith('melt-op-1', 'fee estimation only')
      expect(toNumber(result.fee)).toBe(4) // fee_reserve(3) + swap_fee(1)
      expect(result.method).toBe('lightning')
    })

    it('returns zero fee on error', async () => {
      vi.mocked(backend.prepareMelt).mockRejectedValue(new Error('network error'))

      const result = await adapter.estimateFee({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      expect(toNumber(result.fee)).toBe(0)
    })

    it('rolls back on prepare failure after partial success', async () => {
      vi.mocked(backend.prepareMelt).mockResolvedValueOnce({
        operationId: 'melt-op-2',
        quoteId: 'q2',
        amount: 1000,
        fee_reserve: 5,
        swap_fee: 0,
      })
      vi.mocked(backend.rollbackMelt).mockRejectedValueOnce(new Error('rollback fail'))

      // Should not throw even if rollback fails
      const result = await adapter.estimateFee({
        destination: 'lnbc...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      expect(toNumber(result.fee)).toBe(5)
    })
  })

  // ─── prepareSend ───

  describe('prepareSend', () => {
    it('prepares melt and returns PreparedPayment', async () => {
      const result = await adapter.prepareSend({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
        memo: 'test payment',
      })

      expect(backend.prepareMelt).toHaveBeenCalledWith('https://mint.test', 'lnbc1000n1...')
      expect(result.id).toBe('melt-op-1')
      expect(result.method).toBe('lightning')
      expect(result.protocol).toBe('bolt11')
      expect(toNumber(result.amount)).toBe(1000)
      expect(toNumber(result.fee)).toBe(4)
      expect(result.memo).toBe('test payment')
    })
  })

  // ─── executeSend ───

  describe('executeSend', () => {
    it('executes melt and returns state', async () => {
      const result = await adapter.executeSend('melt-op-1')

      expect(backend.executeMelt).toHaveBeenCalledWith('melt-op-1')
      expect(result.id).toBe('melt-op-1')
      expect(result.state).toBe('finalized')
    })
  })

  // ─── cancelPrepared ───

  describe('cancelPrepared', () => {
    it('rolls back with cancel reason', async () => {
      await adapter.cancelPrepared('melt-op-1')

      expect(backend.rollbackMelt).toHaveBeenCalledWith('melt-op-1', 'cancelled by user')
    })
  })

  // ─── reclaimFailed ───

  describe('reclaimFailed', () => {
    it('rolls back with reclaim reason', async () => {
      await adapter.reclaimFailed('melt-op-1')

      expect(backend.rollbackMelt).toHaveBeenCalledWith('melt-op-1', 'reclaim failed operation')
    })
  })

  // ─── recoverPending ───

  describe('recoverPending', () => {
    it('delegates to backend recovery', async () => {
      const result = await adapter.recoverPending()

      expect(backend.recoverPendingMelts).toHaveBeenCalled()
      expect(result.recovered).toBe(2)
      expect(result.failed).toBe(0)
    })
  })
})
