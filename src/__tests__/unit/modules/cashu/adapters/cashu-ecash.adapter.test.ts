import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CashuEcashAdapter,
  type EcashBackend,
} from '@/modules/cashu/adapters/cashu-ecash.adapter'
import { sat, toNumber } from '@/core/domain/amount'
import { createPendingTransfer } from '@/core/domain/pending-transfer'

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
    finalizeSend: vi.fn().mockResolvedValue(undefined),
    receiveToken: vi.fn().mockResolvedValue({ amount: 498, fee: 2, unit: 'sat', mintUrl: 'https://mint.test' }),
    estimateReceiveFee: vi.fn().mockResolvedValue({ grossAmount: 500, fee: 2, netAmount: 498, unit: 'sat', mintUrl: 'https://mint.test' }),
    recoverPendingSendTokens: vi.fn().mockResolvedValue({ reclaimed: 3, recorded: 1 }),
    redeemPendingReceivedTokens: vi.fn().mockResolvedValue({ redeemed: 0, failed: 0 }),
    storeOfflineToken: vi.fn().mockResolvedValue('pending-recv-123'),
    checkProofStates: vi.fn().mockResolvedValue({ allSpent: false, allPending: false, states: [] }),
    getSendOperationState: vi.fn().mockResolvedValue('prepared'),
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

    it('surfaces an unavailable estimate instead of returning a false zero fee', async () => {
      vi.mocked(backend.prepareSend).mockRejectedValue(new Error('insufficient'))

      await expect(adapter.estimateFee({
        destination: 'cashuBpXh...',
        amount: sat(500),
        accountId: 'https://mint.test',
      })).rejects.toThrow('insufficient')
    })

    it('surfaces rollback failure because the temporary lock release is not confirmed', async () => {
      vi.mocked(backend.rollbackSend).mockRejectedValueOnce(new Error('rollback fail'))

      await expect(adapter.estimateFee({
        destination: 'cashuBpXh...',
        amount: sat(500),
        accountId: 'https://mint.test',
      })).rejects.toThrow('rollback fail')
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
      // the second call must have no memo
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
    it('delegates to backend receiveToken and returns RedeemResult with net amount', async () => {
      const result = await adapter.redeem('cashuBpXh...')

      expect(backend.receiveToken).toHaveBeenCalledWith('cashuBpXh...')
      // net amount = gross(500) - fee(2) = 498
      expect(toNumber(result.amount)).toBe(498)
      expect(result.amount.unit).toBe('sat')
      // fee is exposed as a separate field
      expect(result.fee).toBeDefined()
      expect(toNumber(result.fee!)).toBe(2)
      expect(result.method).toBe('cashu:ecash')
      expect(result.protocol).toBe('cashu-token')
      expect(result.completed).toBe(true)
      expect(result.requestId).not.toBe('')
      expect(result.accountId).toBe('https://mint.test')
    })

    it('fee is undefined when no fee is charged', async () => {
      vi.mocked(backend.receiveToken).mockResolvedValueOnce({
        amount: 500, fee: 0, unit: 'sat', mintUrl: 'https://mint.test',
      })
      const result = await adapter.redeem('cashuBpXh...')

      expect(toNumber(result.amount)).toBe(500)
      expect(result.fee).toBeUndefined()
    })
  })

  // ─── stuck-sweep matrix ───

  describe('pollLocal / confirmStuck', () => {
    function makeSend(overrides: Partial<Parameters<typeof createPendingTransfer>[0]> = {}) {
      return createPendingTransfer({
        id: 't-send',
        txId: 'tx-send',
        direction: 'outgoing',
        finality: 'revocable',
        onExpiry: 'reclaim',
        transportRef: { operationId: 'send-op-1', token: 'cashuBtoken' },
        now: Date.now(),
        ...overrides,
      })
    }
    function makeIncoming(expiresAt?: number) {
      return createPendingTransfer({
        id: 't-recv',
        txId: 'tx-recv',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'expire',
        expiresAt,
        transportRef: { type: 'nostr-giftwrap', protocol: 'ecash', token: 'cashuBtoken' },
        now: Date.now(),
      })
    }

    it('pollLocal(send): settles from LOCAL op state without checkProofStates', async () => {
      vi.mocked(backend.getSendOperationState).mockResolvedValueOnce('finalized')

      await expect(adapter.pollLocal(makeSend())).resolves.toBe('settled')
      expect(backend.checkProofStates).not.toHaveBeenCalled()
    })

    it('pollLocal(send): rolled_back → recoverable, non-terminal state keeps its phase', async () => {
      vi.mocked(backend.getSendOperationState).mockResolvedValueOnce('rolled_back')
      await expect(adapter.pollLocal(makeSend())).resolves.toBe('recoverable')

      vi.mocked(backend.getSendOperationState).mockResolvedValueOnce('pending')
      const t = makeSend()
      await expect(adapter.pollLocal(t)).resolves.toBe(t.phase)
    })

    it('pollLocal(send): does not finalize expiry locally — confirm checks allSpent first (review #2)', async () => {
      vi.mocked(backend.getSendOperationState).mockResolvedValueOnce('pending')
      const expired = makeSend({ expiresAt: Date.now() - 1_000 })

      await expect(adapter.pollLocal(expired)).resolves.toBe(expired.phase)

      // confirm path: if already redeemed, settled takes priority over expiry
      vi.mocked(backend.checkProofStates).mockResolvedValueOnce({ allSpent: true, allPending: false, states: [] })
      await expect(adapter.confirmStuck(expired)).resolves.toBe('settled')

      // unredeemed + expired → recoverable (shows reclaim UI)
      vi.mocked(backend.checkProofStates).mockResolvedValueOnce({ allSpent: false, allPending: false, states: [] })
      await expect(adapter.confirmStuck(expired)).resolves.toBe('recoverable')
    })

    it('pollLocal(incoming awaiting manual receive): checks expiry only, no remote', async () => {
      await expect(adapter.pollLocal(makeIncoming(Date.now() - 1))).resolves.toBe('failed')

      const alive = makeIncoming(Date.now() + 60_000)
      await expect(adapter.pollLocal(alive)).resolves.toBe(alive.phase)
      expect(backend.getSendOperationState).not.toHaveBeenCalled()
      expect(backend.checkProofStates).not.toHaveBeenCalled()
    })

    it('confirmStuck(send): isolated checkProofsStates call — allSpent → settled (§5.4 exception 4)', async () => {
      vi.mocked(backend.checkProofStates).mockResolvedValueOnce({ allSpent: true, allPending: false, states: [] })

      await expect(adapter.confirmStuck(makeSend())).resolves.toBe('settled')
      expect(backend.checkProofStates).toHaveBeenCalledWith('cashuBtoken')
    })

    it('confirmStuck(incoming): null — no remote-confirm concept, no backend call at all', async () => {
      await expect(adapter.confirmStuck(makeIncoming(Date.now() + 60_000))).resolves.toBeNull()
      expect(backend.checkProofStates).not.toHaveBeenCalled()
      expect(backend.getSendOperationState).not.toHaveBeenCalled()
    })

    it('confirmStuck(send, no token): null — no means to confirm', async () => {
      const noToken = makeSend({ transportRef: { operationId: 'send-op-1' } })
      await expect(adapter.confirmStuck(noToken)).resolves.toBeNull()
    })
  })
})
