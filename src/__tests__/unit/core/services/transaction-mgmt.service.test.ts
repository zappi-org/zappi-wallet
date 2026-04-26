import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransactionMgmtService } from '@/core/services/transaction-mgmt.service'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SendTokenOperator, ProofStateResult } from '@/core/ports/driven/send-token-operator.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import { sat } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'

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
    reclaimToken: vi.fn().mockResolvedValue({
      amount: sat(1000),
      accountId: 'https://mint',
    }),
    checkProofStates: vi.fn().mockResolvedValue({
      allSpent: false,
      allPending: false,
      states: [],
    } satisfies ProofStateResult),
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

function createUnclaimedTx(id = 'tx1'): Transaction {
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
  }
}

describe('TransactionMgmtService', () => {
  let txRepo: ReturnType<typeof createMockTxRepo>
  let sendOp: ReturnType<typeof createMockSendOp>
  let pendingOps: ReturnType<typeof createMockPendingOps>
  let eventBus: ReturnType<typeof createMockEventBus>
  let svc: TransactionMgmtService

  beforeEach(() => {
    txRepo = createMockTxRepo()
    sendOp = createMockSendOp()
    pendingOps = createMockPendingOps()
    eventBus = createMockEventBus()
    svc = new TransactionMgmtService(txRepo, sendOp, pendingOps, eventBus)
  })

  it('should get transaction by id', async () => {
    const mockTx = { id: 'tx1', direction: 'send' as const, method: 'cashu:lightning', protocol: 'bolt11', amount: sat(1000), accountId: 'https://mint', status: 'pending' as const, createdAt: Date.now() }
    vi.mocked(txRepo.getById).mockResolvedValue(mockTx)
    const result = await svc.getById('tx1')
    expect(result).toEqual(mockTx)
  })

  it('should reclaim with operationId', async () => {
    vi.mocked(txRepo.getById)
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce(null)
    const result = await svc.reclaimSendToken('tx1', 'op1')
    expect(result.success).toBe(true)
    expect(sendOp.rollbackSendToken).toHaveBeenCalledWith('op1')
    expect(txRepo.update).toHaveBeenCalledWith('tx1', {
      status: 'settled',
      outcome: 'reclaimed',
      completedAt: expect.any(Number),
    })
    expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tx1-reclaim',
      direction: 'receive',
      status: 'settled',
    }))
    expect(pendingOps.delete).toHaveBeenCalledWith('tx1')
  })

  it('treats an already reclaimed transaction as successful for observer/UI races', async () => {
    vi.mocked(sendOp.rollbackSendToken).mockRejectedValue(new Error('already rolled back'))
    vi.mocked(txRepo.getById).mockResolvedValue({
      ...createUnclaimedTx(),
      status: 'settled',
      outcome: 'reclaimed',
    })

    const result = await svc.reclaimSendToken('tx1', 'op1')

    expect(result).toEqual({ success: true })
    expect(sendOp.rollbackSendToken).not.toHaveBeenCalled()
    expect(txRepo.update).not.toHaveBeenCalled()
    expect(txRepo.save).not.toHaveBeenCalled()
  })

  it('treats rollback failure as success if the observer recorded reclaim concurrently', async () => {
    vi.mocked(sendOp.rollbackSendToken).mockRejectedValue(new Error('already rolled back'))
    vi.mocked(txRepo.getById)
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce({
        ...createUnclaimedTx(),
        status: 'settled',
        outcome: 'reclaimed',
      })

    const result = await svc.reclaimSendToken('tx1', 'op1')

    expect(result).toEqual({ success: true })
    expect(sendOp.rollbackSendToken).toHaveBeenCalledWith('op1')
    expect(txRepo.update).not.toHaveBeenCalled()
    expect(txRepo.save).not.toHaveBeenCalled()
  })

  it('does not hide local reclaim recording failures as concurrent success', async () => {
    vi.mocked(txRepo.getById)
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce(null)
    vi.mocked(txRepo.save).mockRejectedValue(new Error('save failed'))

    await expect(svc.reclaimSendToken('tx1', 'op1')).rejects.toThrow('save failed')

    expect(sendOp.rollbackSendToken).toHaveBeenCalledWith('op1')
    expect(txRepo.update).not.toHaveBeenCalled()
    expect(pendingOps.delete).not.toHaveBeenCalled()
  })

  it('reclaims legacy token payloads before recording them as reclaimed', async () => {
    vi.mocked(sendOp.reclaimToken).mockResolvedValue({
      amount: sat(990),
      fee: sat(10),
      accountId: 'https://mint',
    })
    vi.mocked(txRepo.getById)
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce(createUnclaimedTx())
      .mockResolvedValueOnce(null)

    const result = await svc.reclaimSendToken('tx1', undefined, 'cashuAtoken')

    expect(result).toEqual({ success: true })
    expect(sendOp.checkProofStates).toHaveBeenCalledWith('cashuAtoken')
    expect(sendOp.reclaimToken).toHaveBeenCalledWith('cashuAtoken')
    expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tx1-reclaim',
      direction: 'receive',
      status: 'settled',
      amount: sat(990),
      accountId: 'https://mint',
      fee: { quoted: sat(10), effective: sat(10) },
    }))
    expect(txRepo.update).toHaveBeenCalledWith('tx1', {
      status: 'settled',
      outcome: 'reclaimed',
      completedAt: expect.any(Number),
    })
  })

  it('does not mark legacy token payloads reclaimed when token reclaim fails', async () => {
    vi.mocked(txRepo.getById).mockResolvedValue(createUnclaimedTx())
    vi.mocked(sendOp.reclaimToken).mockRejectedValue(new Error('token receive failed'))

    await expect(svc.reclaimSendToken('tx1', undefined, 'cashuAtoken')).rejects.toThrow('token receive failed')

    expect(sendOp.checkProofStates).toHaveBeenCalledWith('cashuAtoken')
    expect(sendOp.reclaimToken).toHaveBeenCalledWith('cashuAtoken')
    expect(txRepo.save).not.toHaveBeenCalled()
    expect(txRepo.update).not.toHaveBeenCalled()
  })

  it('does not mutate wallet state when the source transaction is missing', async () => {
    vi.mocked(txRepo.getById).mockResolvedValue(null)

    const operationResult = await svc.reclaimSendToken('missing-tx', 'op1')
    const tokenResult = await svc.reclaimSendToken('missing-tx', undefined, 'cashuAtoken')

    expect(operationResult).toEqual({ success: false })
    expect(tokenResult).toEqual({ success: false })
    expect(sendOp.rollbackSendToken).not.toHaveBeenCalled()
    expect(sendOp.checkProofStates).not.toHaveBeenCalled()
    expect(sendOp.reclaimToken).not.toHaveBeenCalled()
    expect(txRepo.save).not.toHaveBeenCalled()
    expect(txRepo.update).not.toHaveBeenCalled()
  })

  it('should report already spent on reclaim', async () => {
    vi.mocked(txRepo.getById).mockResolvedValue(createUnclaimedTx())
    vi.mocked(sendOp.checkProofStates).mockResolvedValue({
      allSpent: true,
      allPending: false,
      states: [{ secret: 's', state: 'spent' }],
    })
    const result = await svc.reclaimSendToken('tx1', undefined, 'cashuAtoken')
    expect(result.alreadySpent).toBe(true)
    expect(txRepo.update).toHaveBeenCalledWith('tx1', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
    expect(sendOp.reclaimToken).not.toHaveBeenCalled()
  })

  it('does not rewrite non-send or already claimed transactions as reclaimed', async () => {
    vi.mocked(txRepo.getById)
      .mockResolvedValueOnce({
        ...createUnclaimedTx(),
        direction: 'receive',
      })
      .mockResolvedValueOnce({
        ...createUnclaimedTx(),
        direction: 'receive',
      })

    const receiveResult = await svc.reclaimSendToken('tx1', 'op1')

    expect(receiveResult).toEqual({ success: false })
    expect(txRepo.save).not.toHaveBeenCalled()
    expect(txRepo.update).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(txRepo.getById).mockReset()
    vi.mocked(txRepo.getById).mockResolvedValue({
      ...createUnclaimedTx(),
      status: 'settled',
      outcome: 'claimed',
    })

    const claimedResult = await svc.reclaimSendToken('tx1', 'op1')

    expect(claimedResult).toEqual({ success: false, alreadySpent: true })
    expect(sendOp.rollbackSendToken).not.toHaveBeenCalled()
    expect(txRepo.save).not.toHaveBeenCalled()
    expect(txRepo.update).not.toHaveBeenCalled()
  })

  it('should return failure when no operationId and no token', async () => {
    const result = await svc.reclaimSendToken('tx1')
    expect(result.success).toBe(false)
  })

  it('should finalize send', async () => {
    vi.mocked(txRepo.getById).mockResolvedValue(createUnclaimedTx())
    await svc.finalizeSend('tx1', 'op1')
    expect(sendOp.finalizeSend).toHaveBeenCalledWith('op1')
    expect(txRepo.update).toHaveBeenCalledWith('tx1', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: 'payment:completed',
      payload: { txId: 'tx1', method: 'cashu:ecash', amount: sat(1000) },
    })
  })

  it('should list transactions via findAll', async () => {
    const mockTxs = [
      { id: 'tx1', direction: 'send' as const, method: 'cashu:lightning', protocol: 'bolt11', amount: sat(1000), accountId: 'https://mint', status: 'settled' as const, createdAt: Date.now() },
    ]
    vi.mocked(txRepo.findAll).mockResolvedValue(mockTxs)
    const result = await svc.list({ limit: 10 })
    expect(result).toEqual(mockTxs)
    expect(txRepo.findAll).toHaveBeenCalledWith({ limit: 10 })
  })
})
