import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CashuBolt11Adapter,
  type LightningBackend,
} from '@/modules/cashu/adapters/cashu-bolt11.adapter'
import { sat, toNumber } from '@/core/domain/amount'
import { createPendingTransfer } from '@/core/domain/pending-transfer'

// ─── Mock Backend ───

function createMockBackend(): LightningBackend {
  return {
    prepareMelt: vi.fn().mockResolvedValue({
      operationId: 'melt-op-1',
      quoteId: 'quote-1',
      amount: 1000,
      fee_reserve: 3,
      swap_fee: 1,
      unit: 'sat',
    }),
    executeMelt: vi.fn().mockResolvedValue({ state: 'finalized' }),
    rollbackMelt: vi.fn().mockResolvedValue(undefined),
    createMintQuote: vi.fn().mockResolvedValue({
      quote: 'mint-quote-1',
      request: 'lnbc1000n1...',
      expiry: Math.floor(Date.now() / 1000) + 600,
    }),
    checkMintQuote: vi.fn().mockResolvedValue({
      state: 'UNPAID',
    }),
    getMintQuote: vi.fn().mockResolvedValue({
      state: 'UNPAID',
      request: 'lnbc1000n1...',
    }),
    redeemMintQuote: vi.fn().mockResolvedValue(undefined),
    checkMelt: vi.fn().mockResolvedValue({ state: 'PAID', preimage: 'abc123' }),
    refreshMelt: vi.fn().mockResolvedValue({ state: 'finalized' }),
    getMintOpStateLocal: vi.fn().mockResolvedValue(null),
    recoverPendingMelts: vi.fn().mockResolvedValue({ recovered: 2, failed: 0 }),
    recoverPendingQuotes: vi.fn().mockResolvedValue({ recovered: 0, failed: 0, expired: 0 }),
  }
}

describe('CashuBolt11Adapter', () => {
  let adapter: CashuBolt11Adapter
  let backend: LightningBackend

  beforeEach(() => {
    backend = createMockBackend()
    adapter = new CashuBolt11Adapter(backend)
  })

  // ─── Identity ───

  it('has correct id and capabilities', () => {
    expect(adapter.id).toBe('cashu:bolt11')
    expect(adapter.protocol).toBe('bolt11')
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
      expect(result.method).toBe('bolt11')
      expect(result.protocol).toBe('bolt11')
      expect(result.encoded).toBe('lnbc1000n1...')
      expect(toNumber(result.amount)).toBe(1000)
      expect(result.expiresAt).toBeGreaterThan(Date.now())
    })
  })

  describe('checkAlive', () => {
    it('returns true when the remote mint reports a known quote state', async () => {
      await expect(adapter.checkAlive({
        requestId: 'mint-quote-1',
        accountId: 'https://mint.test',
      })).resolves.toBe(true)

      expect(backend.checkMintQuote).toHaveBeenCalledWith('https://mint.test', 'mint-quote-1')
    })

    it('returns false when the remote mint no longer knows the quote', async () => {
      vi.mocked(backend.checkMintQuote).mockResolvedValueOnce(null)

      await expect(adapter.checkAlive({
        requestId: 'missing-quote',
        accountId: 'https://mint.test',
      })).resolves.toBe(false)
    })

    it('treats terminal paid states as alive for effective-expiry checks', async () => {
      vi.mocked(backend.checkMintQuote).mockResolvedValueOnce({ state: 'PAID' })

      await expect(adapter.checkAlive({
        requestId: 'paid-quote',
        accountId: 'https://mint.test',
      })).resolves.toBe(true)
    })
  })

  // ─── poll (incoming) ───

  describe('poll (incoming)', () => {
    function makeIncomingTransfer(expiresAt?: number) {
      return createPendingTransfer({
        id: 'transfer-1',
        txId: 'tx-1',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'fail',
        expiresAt,
        transportRef: { mintUrl: 'https://mint.test', quoteId: 'xF5AAb_W' },
        now: 1_700_000_000_000,
      })
    }

    it('short-circuits to failed when local expiresAt is past, without calling the mint', async () => {
      const transfer = makeIncomingTransfer(1_700_000_000_000 - 1)

      const result = await adapter.poll(transfer)

      expect(result).toBe('failed')
      expect(backend.checkMintQuote).not.toHaveBeenCalled()
    })

    it('catches SDK EXPIRED throw and returns failed (does not rethrow)', async () => {
      vi.mocked(backend.checkMintQuote).mockRejectedValueOnce(
        new Error('Unexpected mint quote state: EXPIRED for xF5AAb_W'),
      )
      const transfer = makeIncomingTransfer(Date.now() + 60_000)

      const result = await adapter.poll(transfer)

      expect(result).toBe('failed')
    })

    it('rethrows non-EXPIRED errors so the poll loop can surface them', async () => {
      vi.mocked(backend.checkMintQuote).mockRejectedValueOnce(new Error('network down'))
      const transfer = makeIncomingTransfer(Date.now() + 60_000)

      await expect(adapter.poll(transfer)).rejects.toThrow('network down')
    })

    it('returns awaiting_confirmation on PAID', async () => {
      vi.mocked(backend.checkMintQuote).mockResolvedValueOnce({ state: 'PAID' })
      const transfer = makeIncomingTransfer(Date.now() + 60_000)

      await expect(adapter.poll(transfer)).resolves.toBe('awaiting_confirmation')
    })

    it('returns settled on ISSUED', async () => {
      vi.mocked(backend.checkMintQuote).mockResolvedValueOnce({ state: 'ISSUED' })
      const transfer = makeIncomingTransfer(Date.now() + 60_000)

      await expect(adapter.poll(transfer)).resolves.toBe('settled')
    })

    it('returns submitted on UNPAID while still within expiry window', async () => {
      vi.mocked(backend.checkMintQuote).mockResolvedValueOnce({ state: 'UNPAID' })
      const transfer = makeIncomingTransfer(Date.now() + 60_000)

      await expect(adapter.poll(transfer)).resolves.toBe('submitted')
    })
  })

  // ─── poll (outgoing melt) ───

  describe('poll (outgoing melt)', () => {
    function makeOutgoingTransfer() {
      return createPendingTransfer({
        id: 'transfer-out-1',
        txId: 'tx-out-1',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { operationId: 'melt-op-1' },
        now: Date.now(),
      })
    }

    it('returns settled on finalized/preimage', async () => {
      vi.mocked(backend.checkMelt).mockResolvedValueOnce({ state: 'finalized', preimage: 'abc' })

      await expect(adapter.poll(makeOutgoingTransfer())).resolves.toBe('settled')
    })

    /**
     * Regression guard: Coco melt op state has no 'FAILED'
     * (init|prepared|executing|pending|finalized|rolling_back|rolled_back).
     * Old code checked only 'FAILED', so failures (rolled_back) leaked as
     * in_transit — an active bug that recoverPendingMelts happened to mask on unlock.
     */
    it('returns failed on rolled_back (Coco terminal failure state)', async () => {
      vi.mocked(backend.checkMelt).mockResolvedValueOnce({ state: 'rolled_back' })

      await expect(adapter.poll(makeOutgoingTransfer())).resolves.toBe('failed')
    })

    it('returns failed on rolling_back (mid-rollback — payment did not go through)', async () => {
      vi.mocked(backend.checkMelt).mockResolvedValueOnce({ state: 'rolling_back' })

      await expect(adapter.poll(makeOutgoingTransfer())).resolves.toBe('failed')
    })

    it('returns failed when the backend reports an error (operation not found)', async () => {
      vi.mocked(backend.checkMelt).mockResolvedValueOnce({ state: 'unknown', error: 'operation not found' })

      await expect(adapter.poll(makeOutgoingTransfer())).resolves.toBe('failed')
    })

    it('returns in_transit while the melt is still pending', async () => {
      vi.mocked(backend.checkMelt).mockResolvedValueOnce({ state: 'pending' })

      await expect(adapter.poll(makeOutgoingTransfer())).resolves.toBe('in_transit')
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

    it('surfaces an unavailable estimate instead of returning a false zero fee', async () => {
      vi.mocked(backend.prepareMelt).mockRejectedValue(new Error('network error'))

      await expect(adapter.estimateFee({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })).rejects.toThrow('network error')
    })

    it('surfaces rollback failure because the temporary lock release is not confirmed', async () => {
      vi.mocked(backend.prepareMelt).mockResolvedValueOnce({
        operationId: 'melt-op-2',
        quoteId: 'q2',
        amount: 1000,
        fee_reserve: 5,
        swap_fee: 0,
        unit: 'sat',
      })
      vi.mocked(backend.rollbackMelt).mockRejectedValueOnce(new Error('rollback fail'))

      await expect(adapter.estimateFee({
        destination: 'lnbc...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })).rejects.toThrow('rollback fail')
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
      // First prepare to store unit
      await adapter.prepareSend({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      const result = await adapter.executeSend('melt-op-1')

      expect(backend.executeMelt).toHaveBeenCalledWith('melt-op-1')
      expect(result.id).toBe('melt-op-1')
      expect(result.state).toBe('finalized')
    })

    it('returns effectiveFee when SDK provides it', async () => {
      // Prepare first to store unit
      await adapter.prepareSend({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      // Mock SDK returning effectiveFee
      vi.mocked(backend.executeMelt).mockResolvedValueOnce({
        state: 'finalized',
        preimage: 'abc123',
        effectiveFee: 2, // actual fee lower than quoted (4)
        changeAmount: 2,
      })

      const result = await adapter.executeSend('melt-op-1')

      expect(result.effectiveFee).toBeDefined()
      expect(toNumber(result.effectiveFee!)).toBe(2)
      expect(result.effectiveFee!.unit).toBe('sat')
    })

    it('does not return effectiveFee when SDK does not provide it', async () => {
      // Prepare first
      await adapter.prepareSend({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      // Mock SDK without effectiveFee
      vi.mocked(backend.executeMelt).mockResolvedValueOnce({
        state: 'finalized',
        preimage: 'abc123',
      })

      const result = await adapter.executeSend('melt-op-1')

      expect(result.effectiveFee).toBeUndefined()
    })

    it('throws when no pending payment found', async () => {
      await expect(adapter.executeSend('unknown-op')).rejects.toThrow('No pending payment')
    })

    it('preserves unit from prepare phase', async () => {
      // Mock prepareMelt with different unit
      vi.mocked(backend.prepareMelt).mockResolvedValueOnce({
        operationId: 'melt-op-2',
        quoteId: 'q2',
        amount: 1000,
        fee_reserve: 3,
        swap_fee: 1,
        unit: 'usd',
      })

      await adapter.prepareSend({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      vi.mocked(backend.executeMelt).mockResolvedValueOnce({
        state: 'finalized',
        effectiveFee: 2,
      })

      const result = await adapter.executeSend('melt-op-2')

      expect(result.effectiveFee?.unit).toBe('usd')
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

  // ─── stuck-sweep matrix ───

  describe('pollLocal (sweep pass 1 — zero-network contract)', () => {
    function makeIncoming(expiresAt?: number) {
      return createPendingTransfer({
        id: 't-in',
        txId: 'tx-in',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'fail',
        expiresAt,
        transportRef: { mintUrl: 'https://mint.test', quoteId: 'q-1' },
        now: Date.now(),
      })
    }
    function makeOutgoing() {
      return createPendingTransfer({
        id: 't-out',
        txId: 'tx-out',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { operationId: 'op-1' },
        now: Date.now(),
      })
    }

    it('incoming: settles from the LOCAL mint op state without checkMintQuote', async () => {
      vi.mocked(backend.getMintOpStateLocal).mockResolvedValueOnce({ state: 'finalized' })

      await expect(adapter.pollLocal(makeIncoming(Date.now() + 60_000))).resolves.toBe('settled')
      expect(backend.checkMintQuote).not.toHaveBeenCalled()
    })

    it('incoming: local failed op → failed; untracked(null) → keeps phase', async () => {
      vi.mocked(backend.getMintOpStateLocal).mockResolvedValueOnce({ state: 'failed' })
      await expect(adapter.pollLocal(makeIncoming(Date.now() + 60_000))).resolves.toBe('failed')

      vi.mocked(backend.getMintOpStateLocal).mockResolvedValueOnce(null)
      const t = makeIncoming(Date.now() + 60_000)
      await expect(adapter.pollLocal(t)).resolves.toBe(t.phase)
    })

    it('incoming: expiry short-circuits before any lookup', async () => {
      await expect(adapter.pollLocal(makeIncoming(Date.now() - 1))).resolves.toBe('failed')
      expect(backend.getMintOpStateLocal).not.toHaveBeenCalled()
    })

    it('outgoing: maps the LOCAL melt op state (checkMelt reads the repo)', async () => {
      vi.mocked(backend.checkMelt).mockResolvedValueOnce({ state: 'rolled_back' })

      await expect(adapter.pollLocal(makeOutgoing())).resolves.toBe('failed')
      expect(backend.refreshMelt).not.toHaveBeenCalled()
    })
  })

  describe('confirmStuck (§7.3 one remote check)', () => {
    function makeOutgoing() {
      return createPendingTransfer({
        id: 't-out',
        txId: 'tx-out',
        direction: 'outgoing',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: { operationId: 'op-1' },
        now: Date.now(),
      })
    }

    it('outgoing melt: refreshes REMOTE state via ops.melt.refresh — not checkMelt', async () => {
      vi.mocked(backend.refreshMelt).mockResolvedValueOnce({ state: 'finalized' })

      await expect(adapter.confirmStuck(makeOutgoing())).resolves.toBe('settled')
      expect(backend.refreshMelt).toHaveBeenCalledWith('op-1')
      expect(backend.checkMelt).not.toHaveBeenCalled()
    })

    it('outgoing melt: rolled_back → failed', async () => {
      vi.mocked(backend.refreshMelt).mockResolvedValueOnce({ state: 'rolled_back' })

      await expect(adapter.confirmStuck(makeOutgoing())).resolves.toBe('failed')
    })

    it('outgoing melt: a refresh failure throws — mapping it to failed would be a funds bug', async () => {
      vi.mocked(backend.refreshMelt).mockRejectedValueOnce(new Error('mint down'))

      await expect(adapter.confirmStuck(makeOutgoing())).rejects.toThrow('mint down')
    })

    it('incoming: delegates to poll (remote check via checkPayment)', async () => {
      vi.mocked(backend.checkMintQuote).mockResolvedValueOnce({ state: 'ISSUED' })
      const transfer = createPendingTransfer({
        id: 't-in',
        txId: 'tx-in',
        direction: 'incoming',
        finality: 'deferred',
        onExpiry: 'fail',
        expiresAt: Date.now() + 60_000,
        transportRef: { mintUrl: 'https://mint.test', quoteId: 'q-1' },
        now: Date.now(),
      })

      await expect(adapter.confirmStuck(transfer)).resolves.toBe('settled')
      expect(backend.checkMintQuote).toHaveBeenCalledWith('https://mint.test', 'q-1')
    })
  })
})
