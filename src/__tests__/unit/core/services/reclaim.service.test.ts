import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReclaimService } from '@/core/services/reclaim.service'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type { EventBus } from '@/core/events/event-bus'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'
import { TokenSpentError } from '@/core/errors/cashu'

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

    it('should return TokenSpentError when transaction already claimed', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(createClaimedTx())

      const result = await service.reclaim('tx1')

      expect(!result.ok).toBe(true)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(TokenSpentError)
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
    it('should finalize send by operationId', async () => {
      const tx = createUnclaimedSendTx('tx1', {
        metadata: { operationId: 'op1' },
      })
      vi.mocked(txRepo.getById).mockResolvedValue(tx)

      await service.finalizeSend('tx1')

      expect(sendOp.finalizeSend).toHaveBeenCalledWith('op1')
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
