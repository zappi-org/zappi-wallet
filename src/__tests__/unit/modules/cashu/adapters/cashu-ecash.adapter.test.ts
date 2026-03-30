import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CashuEcashAdapter,
  type EcashBackend,
  type SendParamsWithTarget,
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
    receiveToken: vi.fn().mockResolvedValue(undefined),
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

  // ─── parseInput ───

  describe('parseInput', () => {
    it('parses cashu token (cashuB)', () => {
      const result = adapter.parseInput('cashuBpXh...')
      expect(result).toEqual({
        method: 'ecash',
        protocol: 'cashu-token',
        destination: 'cashuBpXh...',
      })
    })

    it('parses cashu token (cashuA)', () => {
      const result = adapter.parseInput('cashuAeyJ...')
      expect(result).not.toBeNull()
      expect(result!.protocol).toBe('cashu-token')
    })

    it('parses cashu request (creqB)', () => {
      const result = adapter.parseInput('creqBpXh...')
      expect(result).toEqual({
        method: 'ecash',
        protocol: 'cashu-request',
        destination: 'creqBpXh...',
      })
    })

    it('parses cashu request (creqA)', () => {
      const result = adapter.parseInput('creqAeyJ...')
      expect(result).not.toBeNull()
      expect(result!.protocol).toBe('cashu-request')
    })

    it('is case insensitive', () => {
      expect(adapter.parseInput('CASHUB...')).not.toBeNull()
      expect(adapter.parseInput('CREQB...')).not.toBeNull()
    })

    it('returns null for bolt11 invoice', () => {
      expect(adapter.parseInput('lnbc1000n1...')).toBeNull()
    })

    it('returns null for lightning address', () => {
      expect(adapter.parseInput('user@wallet.com')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(adapter.parseInput('')).toBeNull()
    })

    it('trims whitespace', () => {
      const result = adapter.parseInput('  cashuBpXh...  ')
      expect(result!.destination).toBe('cashuBpXh...')
    })
  })

  // ─── estimateFee ───

  describe('estimateFee', () => {
    it('returns fee from prepare → rollback pattern', async () => {
      const result = await adapter.estimateFee({
        destination: 'cashuBpXh...',
        amount: sat(500),
        mintUrl: 'https://mint.test',
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
        mintUrl: 'https://mint.test',
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
        mintUrl: 'https://mint.test',
        memo: 'coffee',
      })

      expect(backend.prepareSend).toHaveBeenCalledWith({
        mintUrl: 'https://mint.test',
        amount: 500,
        target: undefined,
      })
      expect(result.id).toBe('send-op-1')
      expect(result.method).toBe('ecash')
      expect(toNumber(result.amount)).toBe(500)
      expect(toNumber(result.fee)).toBe(2)
      expect(result.memo).toBe('coffee')
    })

    it('prepares send with P2PK target', async () => {
      const params: SendParamsWithTarget = {
        destination: 'creqBpXh...',
        amount: sat(500),
        mintUrl: 'https://mint.test',
        target: { type: 'p2pk', pubkey: '02abc...' },
      }

      await adapter.prepareSend(params)

      expect(backend.prepareSend).toHaveBeenCalledWith({
        mintUrl: 'https://mint.test',
        amount: 500,
        target: { type: 'p2pk', pubkey: '02abc...' },
      })
    })
  })

  // ─── executeSend ───

  describe('executeSend', () => {
    it('executes send and returns token', async () => {
      const result = await adapter.executeSend('send-op-1', 'test memo')

      expect(backend.executeSend).toHaveBeenCalledWith('send-op-1', { memo: 'test memo' })
      expect(result.id).toBe('send-op-1')
      expect(result.state).toBe('pending')
      expect(result.token).toBe('cashuBtest_token_string')
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

  // ─── receive ───

  describe('receive', () => {
    it('delegates to backend receiveToken', async () => {
      await adapter.receive('cashuBpXh...')
      expect(backend.receiveToken).toHaveBeenCalledWith('cashuBpXh...')
    })
  })
})
