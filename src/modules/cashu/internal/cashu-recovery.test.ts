import { describe, expect, it, vi } from 'vitest'

import { sat } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import {
  recoverPendingQuotes,
  recoverPendingSendTokens,
  reconcileCashu,
  reconcileMintQuotes,
} from './cashu-recovery'
import type { PendingOperation } from '@/core/domain/pending-operation'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

function createPendingOpRepoMock(): PendingOperationRepository {
  return {
    list: vi.fn(),
    listByAccount: vi.fn(),
    delete: vi.fn(),
    deleteExpired: vi.fn(),
    count: vi.fn(),
  }
}

function createTxRepoMock(): TransactionRepository {
  return {
    save: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    findAll: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    deleteOlderThan: vi.fn(),
  }
}

describe('recoverPendingSendTokens', () => {
  it('marks finalized SDK send tokens as claimed when the observer missed the event', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const sendOps = {
      runRecovery: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ state: 'finalized' }),
    }
    const receiveToken = vi.fn()
    const existingTx = {
      id: 'tx-token',
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      amount: sat(100),
      accountId: 'https://mint',
      status: 'pending',
      outcome: 'unclaimed',
      createdAt: 1,
      metadata: {
        operationId: 'op-1',
        token: 'cashuA...',
      },
    } satisfies Transaction

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-token',
        kind: 'send-token',
        accountId: 'https://mint',
        amount: sat(100),
        createdAt: 1,
        metadata: {
          operationId: 'op-1',
          token: 'cashuA...',
        },
      },
    ])
    vi.mocked(txRepo.getById).mockResolvedValue(existingTx)

    const result = await recoverPendingSendTokens({
      pendingOpRepo,
      txRepo,
      sendOps,
      receiveToken,
    })

    expect(result).toEqual({ reclaimed: 0, recorded: 1 })
    expect(sendOps.runRecovery).toHaveBeenCalled()
    expect(sendOps.get).toHaveBeenCalledWith('op-1')
    expect(txRepo.update).toHaveBeenCalledWith('tx-token', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
      metadata: {
        operationId: 'op-1',
        token: 'cashuA...',
        tokenState: 'spent',
      },
    })
    expect(pendingOpRepo.delete).toHaveBeenCalledWith('tx-token')
    expect(receiveToken).not.toHaveBeenCalled()
  })
})

describe('recoverPendingQuotes', () => {
  it('fails inactive mint quotes without checking the mint', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-1',
        kind: 'mint-quote',
        accountId: 'https://inactive.mint/',
        amount: sat(100),
        createdAt: Date.now(),
        metadata: { quoteId: 'quote-1' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 0, failed: 1, expired: 0 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-1', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('treats an explicit empty active mint list as authoritative', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-empty-active-list',
        kind: 'mint-quote',
        accountId: 'https://inactive.mint/',
        amount: sat(100),
        createdAt: Date.now(),
        metadata: { quoteId: 'quote-empty' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: [],
    })

    expect(result).toEqual({ recovered: 0, failed: 1, expired: 0 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-empty-active-list', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('expires quotes from their real expiresAt without checking the mint', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-expired',
        kind: 'mint-quote',
        accountId: 'https://active.mint',
        amount: sat(150),
        createdAt: Date.now(),
        expiresAt: Date.now() - 1_000,
        metadata: { quoteId: 'quote-expired' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 0, failed: 0, expired: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-expired', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('prefers expiresAt over the legacy createdAt fallback when both exist', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn().mockResolvedValue({ state: 'ISSUED' }),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-expiry-precedence',
        kind: 'mint-quote',
        accountId: 'https://active.mint',
        amount: sat(175),
        createdAt: Date.now() - (25 * 60 * 60 * 1000),
        expiresAt: Date.now() + (5 * 60 * 1000),
        metadata: { quoteId: 'quote-precedence' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 1, failed: 0, expired: 0 })
    expect(quoteOps.checkMintQuote).toHaveBeenCalledWith('quote-precedence', 'https://active.mint')
    expect(txRepo.update).toHaveBeenCalledWith('tx-expiry-precedence', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
  })

  it('falls back to the legacy 24h age check when expiresAt is missing', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-legacy-expired',
        kind: 'mint-quote',
        accountId: 'https://active.mint',
        amount: sat(150),
        createdAt: Date.now() - (25 * 60 * 60 * 1000),
        metadata: { quoteId: 'quote-legacy' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 0, failed: 0, expired: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-legacy-expired', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('continues normal recovery for active mint quotes', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn().mockResolvedValue({ state: 'ISSUED' }),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-2',
        kind: 'mint-quote',
        accountId: 'https://active.mint/',
        amount: sat(200),
        createdAt: Date.now(),
        metadata: { quoteId: 'quote-2' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 1, failed: 0, expired: 0 })
    expect(quoteOps.checkMintQuote).toHaveBeenCalledWith('quote-2', 'https://active.mint/')
    expect(txRepo.update).toHaveBeenCalledWith('tx-2', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
  })
})

// ─── reconcile (설계 §6.1 B5/B6이중망/B7b — 로컬 정합, 네트워크 0) ───

function quoteOp(id: string, overrides: Partial<PendingOperation> = {}): PendingOperation {
  return {
    id,
    kind: 'mint-quote',
    accountId: 'https://active.mint',
    amount: sat(100),
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
    metadata: { quoteId: `q-${id}` },
    ...overrides,
  }
}

describe('reconcileMintQuotes (분기 표: B5 만료/제거민트/식별불가 · B7b null · B6 finalized · failed · 진행중 무간섭)', () => {
  async function run(ops: PendingOperation[], lookup: Record<string, { state: string } | null>) {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    vi.mocked(pendingOpRepo.list).mockResolvedValue(ops)
    const mintOpLookup = vi.fn(async (_mintUrl: string, quoteId: string) => {
      if (!(quoteId in lookup)) throw new Error(`unexpected lookup ${quoteId}`)
      return lookup[quoteId]
    })
    const result = await reconcileMintQuotes({
      pendingOpRepo,
      txRepo,
      activeMintUrls: ['https://active.mint'],
      mintOpLookup,
    })
    return { result, txRepo, pendingOpRepo, mintOpLookup }
  }

  it('B5: expired quote → failed, without any Coco lookup', async () => {
    const { result, txRepo, mintOpLookup } = await run(
      [quoteOp('exp', { expiresAt: Date.now() - 1000 })],
      {},
    )

    expect(result).toEqual({ settled: 0, failed: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('exp', { status: 'failed', completedAt: expect.any(Number) })
    expect(mintOpLookup).not.toHaveBeenCalled()
  })

  it('B5: removed-mint quote → failed, without any Coco lookup', async () => {
    const { result, txRepo, mintOpLookup } = await run(
      [quoteOp('gone', { accountId: 'https://removed.mint' })],
      {},
    )

    expect(result).toEqual({ settled: 0, failed: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('gone', { status: 'failed', completedAt: expect.any(Number) })
    expect(mintOpLookup).not.toHaveBeenCalled()
  })

  it('B5: unidentifiable quote (no quoteId) is failed only once expired', async () => {
    const fresh = quoteOp('fresh-anon', { metadata: {} })
    const expired = quoteOp('exp-anon', { metadata: {}, expiresAt: Date.now() - 1000 })
    const { result, txRepo } = await run([fresh, expired], {})

    expect(result).toEqual({ settled: 0, failed: 1 })
    expect(txRepo.update).toHaveBeenCalledTimes(1)
    expect(txRepo.update).toHaveBeenCalledWith('exp-anon', { status: 'failed', completedAt: expect.any(Number) })
  })

  it('B7b: Coco-untracked quote (lookup null) → failed 종결 — 의도적 행동 변경', async () => {
    const { result, txRepo } = await run([quoteOp('orphan')], { 'q-orphan': null })

    expect(result).toEqual({ settled: 0, failed: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('orphan', { status: 'failed', completedAt: expect.any(Number) })
  })

  it('B6 이중망: local finalized op settles the pending tx (observer 유실 회수)', async () => {
    const { result, txRepo } = await run([quoteOp('done')], { 'q-done': { state: 'finalized' } })

    expect(result).toEqual({ settled: 1, failed: 0 })
    expect(txRepo.update).toHaveBeenCalledWith('done', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
  })

  it('local failed op → failed', async () => {
    const { result, txRepo } = await run([quoteOp('bad')], { 'q-bad': { state: 'failed' } })

    expect(result).toEqual({ settled: 0, failed: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('bad', { status: 'failed', completedAt: expect.any(Number) })
  })

  it('in-flight Coco states (init/pending/executing) are left untouched', async () => {
    const { result, txRepo } = await run(
      [quoteOp('a'), quoteOp('b'), quoteOp('c')],
      { 'q-a': { state: 'init' }, 'q-b': { state: 'pending' }, 'q-c': { state: 'executing' } },
    )

    expect(result).toEqual({ settled: 0, failed: 0 })
    expect(txRepo.update).not.toHaveBeenCalled()
  })

  it('a lookup throw skips that quote without marking or aborting the scan', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    vi.mocked(pendingOpRepo.list).mockResolvedValue([quoteOp('boom'), quoteOp('ok')])
    const mintOpLookup = vi
      .fn()
      .mockRejectedValueOnce(new Error('coco not ready'))
      .mockResolvedValueOnce({ state: 'finalized' })

    const result = await reconcileMintQuotes({
      pendingOpRepo,
      txRepo,
      activeMintUrls: ['https://active.mint'],
      mintOpLookup,
    })

    expect(result).toEqual({ settled: 1, failed: 0 })
    expect(txRepo.update).toHaveBeenCalledTimes(1)
    expect(txRepo.update).toHaveBeenCalledWith('ok', expect.objectContaining({ status: 'settled' }))
  })
})

describe('reconcileCashu (네트워크 0 계약)', () => {
  it('composes B3+quotes+B8 and never calls network behaviors', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'send-1',
        kind: 'send-token',
        accountId: 'https://active.mint',
        amount: sat(50),
        createdAt: 1,
        metadata: { operationId: 'op-1' },
      },
      quoteOp('done'),
    ])
    vi.mocked(pendingOpRepo.deleteExpired).mockResolvedValue(3)
    vi.mocked(txRepo.getById).mockResolvedValue({
      id: 'send-1',
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      amount: sat(50),
      accountId: 'https://active.mint',
      status: 'pending',
      outcome: 'unclaimed',
      createdAt: 1,
    } as Transaction)
    // B3는 로컬 op 조회(get)만 — runRecovery(B1 네트워크 sweep)는 타입상 요구되지 않는다
    const sendOps = { get: vi.fn().mockResolvedValue({ state: 'rolled_back' }) }

    const report = await reconcileCashu({
      pendingOpRepo,
      txRepo,
      activeMintUrls: ['https://active.mint'],
      sendOps,
      mintOpLookup: vi.fn().mockResolvedValue({ state: 'finalized' }),
    })

    expect(report).toEqual({ settled: 1, reclaimed: 1, failed: 0, cleaned: 3 })
    expect(pendingOpRepo.deleteExpired).toHaveBeenCalled()
  })
})
