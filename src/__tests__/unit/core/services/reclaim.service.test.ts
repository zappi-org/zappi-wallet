import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReclaimService } from '@/core/services/reclaim.service'
import { PaymentService } from '@/core/services/payment.service'
import { TokenReceiverAdapter } from '@/composition/token-receiver.adapter'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { EventBus } from '@/core/events/event-bus'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'
import { TokenSpentByRecipientError } from '@/core/errors/reclaim'

function createMockTxRepo(): TransactionRepository {
  return {
    save: vi.fn(),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    delete: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    deleteAll: vi.fn(),
    deleteOlderThan: vi.fn(),
  }
}

function createMockSendOp(): SendTokenOperator {
  return {
    rollbackSendToken: vi.fn(),
    finalizeSend: vi.fn(),
    checkProofStates: vi.fn().mockResolvedValue({
      allSpent: false,
      allPending: false,
      states: [],
    }),
  }
}

function createMockTokenReceiver(): TokenReceiver {
  return {
    receiveToken: vi.fn(),
  }
}

function createMockPendingOps(): PendingOperationRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    listByAccount: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    deleteExpired: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  }
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
    off: vi.fn(),
  }
}

// ─── Integration doubles (real PaymentService + in-memory repo) ───
//
// A vi.fn() txRepo mock returns whatever getById is told to, regardless of
// the id it was called with — so it can't catch a requestId/txId mismatch.
// This in-memory double is keyed by id like the real repo, so a stamp that
// looks up the wrong id genuinely misses.
function createInMemoryTxRepo(): TransactionRepository {
  const store = new Map<string, Transaction>()
  return {
    save: async (tx) => {
      store.set(tx.id, tx)
    },
    getById: async (id) => store.get(id) ?? null,
    list: async () => Array.from(store.values()),
    update: async (id, patch) => {
      const existing = store.get(id)
      if (existing) store.set(id, { ...existing, ...patch })
    },
    delete: async (id) => {
      store.delete(id)
    },
    findAll: async () => Array.from(store.values()),
    deleteAll: async () => {
      store.clear()
    },
    deleteOlderThan: async () => {},
  }
}

// Mirrors the real cashu-ecash adapter's redeem(): it returns its own
// requestId (a UUID unrelated to the ledger tx id PaymentService assigns).
function createRedeemAdapter(): PaymentMethodAdapter {
  return {
    id: 'cashu:ecash',
    moduleId: 'cashu',
    protocol: 'ecash',
    supportedUnits: ['sat'],
    capabilities: { canSend: true, canReceive: true, canEstimateFee: true },
    estimateFee: vi.fn(),
    prepareSend: vi.fn(),
    executeSend: vi.fn(),
    cancelPrepared: vi.fn(),
    reclaimFailed: vi.fn(),
    createReceiveRequest: vi.fn(),
    canRedeem: () => true,
    redeem: vi.fn().mockResolvedValue({
      requestId: 'adapter-own-request-id',
      amount: sat(1000),
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: 'https://mint',
    }),
    recoverPending: vi.fn(),
  } as unknown as PaymentMethodAdapter
}

function createRedeemModule(adapter: PaymentMethodAdapter): WalletModule {
  return {
    id: 'cashu',
    displayName: 'Cashu',
    initialize: vi.fn(),
    dispose: vi.fn(),
    isEnabled: () => true,
    send: vi.fn(),
    recoverAccount: vi.fn(),
    getPaymentAdapters: () => [adapter],
    getCapabilities: () => [],
    getBalance: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
  }
}

function createUnclaimedSendTx(id = 'tx1', overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    direction: 'send',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint',
    status: 'pending',
    outcome: 'unclaimed',
    createdAt: Date.now(),
    ...overrides,
  }
}

function createReclaimedTx(id = 'tx1'): Transaction {
  return {
    id,
    direction: 'send',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint',
    status: 'settled',
    outcome: 'reclaimed',
    createdAt: Date.now(),
    completedAt: Date.now(),
  }
}

function createClaimedTx(id = 'tx1'): Transaction {
  return {
    id,
    direction: 'send',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint',
    status: 'settled',
    outcome: 'claimed',
    createdAt: Date.now(),
    completedAt: Date.now(),
  }
}

describe('ReclaimService', () => {
  let txRepo: ReturnType<typeof createMockTxRepo>
  let sendOp: ReturnType<typeof createMockSendOp>
  let tokenReceiver: ReturnType<typeof createMockTokenReceiver>
  let pendingOps: ReturnType<typeof createMockPendingOps>
  let eventBus: ReturnType<typeof createMockEventBus>
  let service: ReclaimService

  beforeEach(() => {
    txRepo = createMockTxRepo()
    sendOp = createMockSendOp()
    tokenReceiver = createMockTokenReceiver()
    pendingOps = createMockPendingOps()
    eventBus = createMockEventBus()
    service = new ReclaimService(txRepo, sendOp, tokenReceiver, pendingOps, eventBus)
  })

  describe('reclaim', () => {
    it('should return error when transaction not found', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(null)

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN')
      }
    })

    it('should return success when transaction already reclaimed', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createReclaimedTx())

      const result = await service.reclaim('tx1')

      expect(result.ok).toBe(true)
      expect(pendingOps.delete).toHaveBeenCalledWith('tx1')
    })

    it('should return TokenSpentByRecipientError when transaction already claimed', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createClaimedTx())

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(TokenSpentByRecipientError)
      }
    })

    it('should return error for non-send transaction', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue({
        ...createUnclaimedSendTx(),
        direction: 'receive',
      })

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN')
      }
    })

    it('should reclaim by operationId successfully', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)
      vi.mocked(sendOp.rollbackSendToken).mockResolvedValue(undefined)

      const result = await service.reclaim('tx1')

      expect(result.ok).toBe(true)
      expect(sendOp.rollbackSendToken).toHaveBeenCalledWith('op1')
      // Rollback's fee is unmeasured — no reclaimFee is persisted for it.
      expect(txRepo.update).toHaveBeenCalledWith('tx1', {
        status: 'settled',
        outcome: 'reclaimed',
        completedAt: expect.any(Number),
      })
      expect(pendingOps.delete).toHaveBeenCalledWith('tx1')
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'transactions:changed',
        payload: { reason: 'send-reclaimed', txId: 'tx1' },
      })
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'balance:changed',
        payload: {
          moduleId: 'cashu',
          accountId: 'https://mint',
        },
      })
    })

    it('should handle concurrent reclaim when rollback fails but tx is reclaimed', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById)
        .mockResolvedValueOnce(tx)
        .mockResolvedValueOnce(createReclaimedTx())
      vi.mocked(sendOp.rollbackSendToken).mockRejectedValue(new Error('already rolled back'))

      const result = await service.reclaim('tx1')

      expect(result.ok).toBe(true)
      expect(sendOp.rollbackSendToken).toHaveBeenCalledWith('op1')
    })

    it('should mark send as claimed when reclaim races with recipient claim', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)
      vi.mocked(sendOp.rollbackSendToken).mockRejectedValue(new Error("Cannot rollback operation in state 'finalized'"))

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(TokenSpentByRecipientError)
      }
      expect(txRepo.update).toHaveBeenCalledWith('tx1', {
        status: 'settled',
        outcome: 'claimed',
        completedAt: expect.any(Number),
      })
      expect(pendingOps.delete).toHaveBeenCalledWith('tx1')
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'send:claimed',
        payload: {
          txId: 'tx1',
          method: 'cashu:ecash',
          protocol: 'cashu-token',
          amount: tx.amount,
          memo: tx.memo,
        },
      })
    })

    it('should return error when rollback fails and tx not reclaimed', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById)
        .mockResolvedValueOnce(tx)
        .mockResolvedValueOnce(tx)
      vi.mocked(sendOp.rollbackSendToken).mockRejectedValue(new Error('rollback failed'))

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN')
      }
    })

    it('should reclaim by token successfully', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { token: 'cashuAabc123' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)
      vi.mocked(tokenReceiver.receiveToken).mockResolvedValue({
        ok: true,
        value: { amount: 1000, transactionId: 'tx1-receive' },
      })

      const result = await service.reclaim('tx1')

      expect(result.ok).toBe(true)
      expect(tokenReceiver.receiveToken).toHaveBeenCalledWith('cashuAabc123')
      expect(txRepo.update).toHaveBeenCalledWith('tx1', expect.objectContaining({
        status: 'settled',
        outcome: 'reclaimed',
      }))
    })

    it('still settles the send as reclaimed when the reclaim provenance stamp write throws (best-effort)', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { token: 'cashuAabc123' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)
      // The stamp write (getById + update on the receive tx) throws — it must
      // be swallowed rather than aborting markSendReclaimed below it.
      vi.mocked(txRepo.update).mockImplementation(async (id) => {
        if (id === 'tx1-receive') throw new Error('storage failure')
      })
      vi.mocked(tokenReceiver.receiveToken).mockResolvedValue({
        ok: true,
        value: { amount: 1000, transactionId: 'tx1-receive' },
      })

      const result = await service.reclaim('tx1')

      expect(result.ok).toBe(true)
      expect(txRepo.update).toHaveBeenCalledWith('tx1', expect.objectContaining({
        status: 'settled',
        outcome: 'reclaimed',
      }))
    })

    it('should return error when token receive fails', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { token: 'cashuAabc123' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)
      vi.mocked(tokenReceiver.receiveToken).mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid token', isRetryable: false },
      })

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TOKEN')
      }
    })

    it('should return error when no operationId or token', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createUnclaimedSendTx())

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN')
      }
    })
  })

  describe('finalizeSend', () => {
    it('should finalize send by operationId and mark transaction as claimed', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)

      await service.finalizeSend('tx1')

      expect(sendOp.finalizeSend).toHaveBeenCalledWith('op1')
      expect(txRepo.update).toHaveBeenCalledWith('tx1', {
        status: 'settled',
        outcome: 'claimed',
        completedAt: expect.any(Number),
      })
      expect(pendingOps.delete).toHaveBeenCalledWith('tx1')
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'send:claimed',
        payload: {
          txId: 'tx1',
          method: 'cashu:ecash',
          protocol: 'cashu-token',
          amount: tx.amount,
          memo: tx.memo,
        },
      })
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'transactions:changed',
        payload: { reason: 'send-claimed', txId: 'tx1' },
      })
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'balance:changed',
        payload: {
          moduleId: 'cashu',
          accountId: 'https://mint',
        },
      })
    })

    it('should still mark transaction as claimed when SDK operation is already finalized', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)
      vi.mocked(sendOp.finalizeSend).mockRejectedValue(new Error("Cannot finalize operation in state 'finalized'"))

      await service.finalizeSend('tx1')

      expect(txRepo.update).toHaveBeenCalledWith('tx1', {
        status: 'settled',
        outcome: 'claimed',
        completedAt: expect.any(Number),
      })
      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'send:claimed',
      }))
    })

    it('should do nothing when transaction not found', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(null)

      await service.finalizeSend('tx1')

      expect(sendOp.finalizeSend).not.toHaveBeenCalled()
    })

    it('should do nothing when no operationId in metadata', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createUnclaimedSendTx())

      await service.finalizeSend('tx1')

      expect(sendOp.finalizeSend).not.toHaveBeenCalled()
      expect(txRepo.update).not.toHaveBeenCalled()
    })

    it('should do nothing when transaction is already claimed', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createClaimedTx())

      await service.finalizeSend('tx1')

      expect(sendOp.finalizeSend).not.toHaveBeenCalled()
      expect(txRepo.update).not.toHaveBeenCalled()
      expect(eventBus.emit).not.toHaveBeenCalled()
    })
  })

  describe('markSendReclaimed', () => {
    it('should mark send as reclaimed and return true', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createUnclaimedSendTx())

      const result = await service.markSendReclaimed('tx1')

      expect(result).toBe(true)
      expect(txRepo.update).toHaveBeenCalledWith('tx1', {
        status: 'settled',
        outcome: 'reclaimed',
        completedAt: expect.any(Number),
      })
      expect(pendingOps.delete).toHaveBeenCalledWith('tx1')
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'transactions:changed',
        payload: { reason: 'send-reclaimed', txId: 'tx1' },
      })
    })

    it('should return false when transaction not found', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(null)

      const result = await service.markSendReclaimed('tx1')

      expect(result).toBe(false)
      expect(txRepo.update).not.toHaveBeenCalled()
    })

    it('should return false when transaction is not reclaimable', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createClaimedTx())

      const result = await service.markSendReclaimed('tx1')

      expect(result).toBe(false)
      expect(txRepo.update).not.toHaveBeenCalled()
    })

    it('should return false for receive transaction', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue({
        ...createUnclaimedSendTx(),
        direction: 'receive',
      })

      const result = await service.markSendReclaimed('tx1')

      expect(result).toBe(false)
    })

    it('should return false for already settled transaction', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createReclaimedTx())

      const result = await service.markSendReclaimed('tx1')

      expect(result).toBe(false)
    })
  })
})

// Real PaymentService + in-memory txRepo, wired the way composition does
// (TokenReceiverAdapter over PaymentUseCase.redeem). A mocked txRepo can't
// expose a requestId/txId mismatch since it returns whatever it's told
// regardless of the id queried — this double is keyed by id for real.
describe('ReclaimService — token path stamps reclaimedFrom (integration)', () => {
  it('marks the ledger receive TX with metadata.reclaimedFrom === sendTxId', async () => {
    const realTxRepo = createInMemoryTxRepo()
    const adapter = createRedeemAdapter()
    const module = createRedeemModule(adapter)
    const paymentService = new PaymentService([module], realTxRepo, createMockEventBus())
    const realTokenReceiver = new TokenReceiverAdapter(paymentService)

    const sendTx = createUnclaimedSendTx('send-tx-1', { metadata: { token: 'cashuAabc123' } })
    await realTxRepo.save(sendTx)

    const service = new ReclaimService(
      realTxRepo,
      createMockSendOp(),
      realTokenReceiver,
      createMockPendingOps(),
      createMockEventBus(),
    )

    const result = await service.reclaim('send-tx-1')

    expect(result.ok).toBe(true)
    const all = await realTxRepo.list()
    const receiveTx = all.find((t) => t.direction === 'receive')
    expect(receiveTx).toBeDefined()
    expect(receiveTx?.metadata?.reclaimedFrom).toBe('send-tx-1')
  })
})
