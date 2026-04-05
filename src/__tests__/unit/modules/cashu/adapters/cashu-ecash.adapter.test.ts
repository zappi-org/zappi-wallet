import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CashuEcashAdapter,
  type EcashBackend,
} from '@/modules/cashu/adapters/cashu-ecash.adapter'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Mock Backend ───

function createMockBackend(): EcashBackend {
  return {
    prepareSend: vi.fn().mockResolvedValue({
      operationId: 'send-op-1',
      fee: 2,
      needsSwap: true,
    }),
    executeSend: vi.fn().mockResolvedValue({
      token: 'cashuBtest_token_string',
    }),
    rollbackSend: vi.fn().mockResolvedValue(undefined),
    receiveToken: vi.fn().mockResolvedValue({ amount: 500, mintUrl: 'https://mint.test' }),
    recoverPendingSendTokens: vi.fn().mockResolvedValue({ reclaimed: 3, recorded: 1 }),
  }
}

describe('CashuEcashAdapter', () => {
  let adapter: CashuEcashAdapter
  let backend: EcashBackend

  beforeEach(() => {
    backend = createMockBackend()
    adapter = new CashuEcashAdapter(backend)
  })

  // ─── Identity ───

  it('has correct id and capabilities', () => {
    expect(adapter.id).toBe('cashu:ecash')
    expect(adapter.moduleId).toBe('cashu')
    expect(adapter.capabilities.canSend).toBe(true)
    expect(adapter.capabilities.canReceive).toBe(true)
    expect(adapter.capabilities.canEstimateFee).toBe(true)
  })

  // ─── estimateFee ───

  describe('estimateFee', () => {
    it('returns fee from prepare → rollback pattern', async () => {
      const result = await adapter.estimateFee({
        destination: 'cashuBpXh...',
        amount: sat(500),
        accountId: 'https://mint.test',
      })

      expect(backend.prepareSend).toHaveBeenCalledWith({
        mintUrl: 'https://mint.test',
        amount: 500,
      })
      expect(backend.rollbackSend).toHaveBeenCalledWith('send-op-1')
      expect(toNumber(result.fee)).toBe(2)
      expect(result.method).toBe('ecash')
    })

    it('returns zero fee on error', async () => {
      vi.mocked(backend.prepareSend).mockRejectedValue(new Error('insufficient'))

      const result = await adapter.estimateFee({
        destination: 'cashuBpXh...',
        amount: sat(500),
        accountId: 'https://mint.test',
      })

      expect(toNumber(result.fee)).toBe(0)
    })
  })

  // ─── prepareSend ───

  describe('prepareSend', () => {
    it('prepares send without P2PK', async () => {
      const result = await adapter.prepareSend({
        destination: 'cashuBpXh...',
        amount: sat(500),
        accountId: 'https://mint.test',
        memo: 'coffee',
      })

      expect(backend.prepareSend).toHaveBeenCalledWith({
        mintUrl: 'https://mint.test',
        amount: 500,
        lockingCondition: undefined,
      })
      expect(result.id).toBe('send-op-1')
      expect(result.method).toBe('ecash')
      expect(toNumber(result.amount)).toBe(500)
      expect(toNumber(result.fee)).toBe(2)
      expect(result.memo).toBe('coffee')
    })

    it('prepares send with P2PK lockingCondition via options', async () => {
      await adapter.prepareSend({
        destination: 'creqBpXh...',
        amount: sat(500),
        accountId: 'https://mint.test',
        options: { lockingCondition: { kind: 'P2PK', data: '02abc...' } },
      })

      expect(backend.prepareSend).toHaveBeenCalledWith({
        mintUrl: 'https://mint.test',
        amount: 500,
        lockingCondition: { kind: 'P2PK', data: '02abc...' },
      })
    })
  })

  // ─── executeSend ───

  describe('executeSend', () => {
    it('executes send and returns token in data', async () => {
      const result = await adapter.executeSend('send-op-1')

      expect(backend.executeSend).toHaveBeenCalledWith('send-op-1', { memo: undefined })
      expect(result.id).toBe('send-op-1')
      expect(result.state).toBe('pending')
      expect(result.data?.token).toBe('cashuBtest_token_string')
    })

    it('passes memo from prepareSend to executeSend', async () => {
      await adapter.prepareSend({
        destination: 'cashuA...',
        amount: sat(500),
        accountId: 'https://mint.test',
        memo: 'test memo',
      })

      await adapter.executeSend('send-op-1')

      expect(backend.executeSend).toHaveBeenCalledWith('send-op-1', { memo: 'test memo' })
    })

    it('clears memo after executeSend', async () => {
      await adapter.prepareSend({
        destination: 'cashuA...',
        amount: sat(500),
        accountId: 'https://mint.test',
        memo: 'once only',
      })

      await adapter.executeSend('send-op-1')
      // 두 번째 호출은 memo가 없어야 함
      await adapter.executeSend('send-op-1')

      expect(backend.executeSend).toHaveBeenLastCalledWith('send-op-1', { memo: undefined })
    })
  })

  // ─── cancelPrepared ───

  describe('cancelPrepared', () => {
    it('calls rollbackSend', async () => {
      await adapter.cancelPrepared('send-op-1')
      expect(backend.rollbackSend).toHaveBeenCalledWith('send-op-1')
    })
  })

  // ─── reclaimFailed ───

  describe('reclaimFailed', () => {
    it('calls rollbackSend', async () => {
      await adapter.reclaimFailed('send-op-1')
      expect(backend.rollbackSend).toHaveBeenCalledWith('send-op-1')
    })
  })

  // ─── recoverPending ───

  describe('recoverPending', () => {
    it('delegates to backend and maps result', async () => {
      const result = await adapter.recoverPending()

      expect(backend.recoverPendingSendTokens).toHaveBeenCalled()
      expect(result.recovered).toBe(3)
      expect(result.failed).toBe(0)
    })
  })

  // ─── redeem ───

  describe('redeem', () => {
    it('delegates to backend receiveToken and returns RedeemResult', async () => {
      const result = await adapter.redeem('cashuBpXh...')

      expect(backend.receiveToken).toHaveBeenCalledWith('cashuBpXh...')
      expect(toNumber(result.amount)).toBe(500)
      expect(result.method).toBe('cashu:ecash')
      expect(result.protocol).toBe('cashu-token')
      expect(result.completed).toBe(true)
      expect(result.requestId).not.toBe('')
      expect(result.accountId).toBe('https://mint.test')
    })
  })
})
