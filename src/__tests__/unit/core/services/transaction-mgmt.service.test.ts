import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransactionMgmtService } from '@/core/services/transaction-mgmt.service'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SendTokenOperator, ProofStateResult } from '@/core/ports/driven/send-token-operator.port'
import { sat } from '@/core/domain/amount'

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
    markSendFinalized: vi.fn(),
    markSendReclaimed: vi.fn(),
    checkProofStates: vi.fn().mockResolvedValue({
      allSpent: false,
      allPending: false,
      states: [],
    } satisfies ProofStateResult),
  }
}

describe('TransactionMgmtService', () => {
  let txRepo: ReturnType<typeof createMockTxRepo>
  let sendOp: ReturnType<typeof createMockSendOp>
  let svc: TransactionMgmtService

  beforeEach(() => {
    txRepo = createMockTxRepo()
    sendOp = createMockSendOp()
    svc = new TransactionMgmtService(txRepo, sendOp)
  })

  it('should get transaction by id', async () => {
    const mockTx = { id: 'tx1', direction: 'send' as const, method: 'cashu:lightning', protocol: 'bolt11', amount: sat(1000), accountId: 'https://mint', status: 'pending' as const, createdAt: Date.now() }
    vi.mocked(txRepo.getById).mockResolvedValue(mockTx)
    const result = await svc.getById('tx1')
    expect(result).toEqual(mockTx)
  })

  it('should reclaim with operationId', async () => {
    const result = await svc.reclaimSendToken('tx1', 'op1')
    expect(result.success).toBe(true)
    expect(sendOp.rollbackSendToken).toHaveBeenCalledWith('op1')
    expect(sendOp.markSendReclaimed).toHaveBeenCalledWith('tx1')
  })

  it('should report already spent on reclaim', async () => {
    vi.mocked(sendOp.checkProofStates).mockResolvedValue({
      allSpent: true,
      allPending: false,
      states: [{ secret: 's', state: 'spent' }],
    })
    const result = await svc.reclaimSendToken('tx1', undefined, 'cashuAtoken')
    expect(result.alreadySpent).toBe(true)
    expect(sendOp.markSendFinalized).toHaveBeenCalledWith('tx1')
  })

  it('should return failure when no operationId and no token', async () => {
    const result = await svc.reclaimSendToken('tx1')
    expect(result.success).toBe(false)
  })

  it('should finalize send', async () => {
    await svc.finalizeSend('tx1', 'op1')
    expect(sendOp.finalizeSend).toHaveBeenCalledWith('op1')
    expect(sendOp.markSendFinalized).toHaveBeenCalledWith('tx1')
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
