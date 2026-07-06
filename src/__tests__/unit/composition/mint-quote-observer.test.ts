/**
 * MintQuoteObserver — Lightning receive 기록 계약 안전망 (감사 잔여 Phase 0, 리뷰 MAJOR-16)
 *
 * 이 모듈은 "민트가 인보이스 결제를 확정(mint-op:finalized)"했을 때 거래내역을
 * 만드는 유일한 통로다. 핀 대상 계약:
 * - Phase 5 경로: OperationMap 매핑이 있으면 기존 pending TX 를 settle (새 TX 생성 금지)
 * - idempotent: 이미 settled/기록된 quote 는 false 반환, 어떤 부수효과도 없음
 * - 기록 성공 시 txRefreshTrigger 증가 + 타 탭 'balance_changed' 브로드캐스트
 * - swap quote 는 skip (스왑 거래는 SwapService 가 별도 기록)
 * - 기록 실패는 이벤트 핸들러 밖으로 새어나가지 않는다 (unhandled rejection 금지)
 *
 * 모듈 전역 주입 상태(injectDependencies) 격리를 위해 테스트마다
 * vi.resetModules + 동적 import 로 새 모듈 인스턴스를 사용한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'

const { legacyRepoMock, broadcastSyncMock } = vi.hoisted(() => ({
  legacyRepoMock: {
    findById: vi.fn(),
    save: vi.fn(),
  },
  broadcastSyncMock: vi.fn(),
}))

vi.mock('@/composition/legacy-transaction-repo', () => ({
  getTransactionRepo: () => legacyRepoMock,
}))
vi.mock('@/utils/cross-tab-sync', () => ({
  broadcastSync: broadcastSyncMock,
}))

async function load() {
  vi.resetModules()
  const observer = await import('@/composition/mint-quote-observer')
  const { useAppStore } = await import('@/store')
  const { markQuoteAsSwap, unmarkQuoteAsSwap } = await import('@/modules/cashu')
  return { observer, useAppStore, markQuoteAsSwap, unmarkQuoteAsSwap }
}

// resolvedTxId 는 명시 필수 — 기본값 병합(??)이 의도된 null 을 삼키는 사고 방지
function makeInjected(opts: {
  resolvedTxId: string | null
  existingTx?: Record<string, unknown> | null
}) {
  const opMap = {
    resolve: vi.fn().mockResolvedValue(opts.resolvedTxId),
    register: vi.fn(),
  } satisfies OperationMap
  const txRepo = {
    getById: vi.fn().mockResolvedValue(
      opts.existingTx === undefined
        ? { id: 'tx-mapped', status: 'pending', metadata: {} }
        : opts.existingTx,
    ),
    update: vi.fn().mockResolvedValue(undefined),
  }
  return { opMap, txRepo: txRepo as unknown as TransactionRepository, txRepoMock: txRepo }
}

const RECEIVE_PARAMS = {
  quoteId: 'quote-1',
  mintUrl: 'https://mint.example.com',
  amount: 21,
  bolt11: 'lnbc-req',
}

describe('recordLightningReceive', () => {
  beforeEach(() => {
    legacyRepoMock.findById.mockReset().mockResolvedValue(null)
    legacyRepoMock.save.mockReset().mockResolvedValue(undefined)
    broadcastSyncMock.mockReset()
  })

  it('Phase 5 경로: 매핑된 pending TX 를 settle 하고 refresh+broadcast 발화', async () => {
    const { observer, useAppStore } = await load()
    const { opMap, txRepo, txRepoMock } = makeInjected({ resolvedTxId: 'tx-mapped' })
    observer.injectDependencies(opMap, txRepo)

    const before = useAppStore.getState().txRefreshTrigger
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(true)
    expect(txRepoMock.update).toHaveBeenCalledWith(
      'tx-mapped',
      expect.objectContaining({
        status: 'settled',
        outcome: 'claimed',
        completedAt: expect.any(Number),
      }),
    )
    // settle 경로에서는 새 TX 를 만들지 않는다 (이중 기록 = 잔액 이중 표시)
    expect(legacyRepoMock.save).not.toHaveBeenCalled()
    expect(useAppStore.getState().txRefreshTrigger).toBe(before + 1)
    expect(broadcastSyncMock).toHaveBeenCalledWith('balance_changed')
  })

  it('Phase 5 경로: bolt11 이 비어 있던 TX 에만 bolt11 백필', async () => {
    const { observer } = await load()
    const { opMap, txRepo, txRepoMock } = makeInjected({ resolvedTxId: 'tx-mapped' })
    observer.injectDependencies(opMap, txRepo)

    await observer.recordLightningReceive(RECEIVE_PARAMS)
    const updateArg = txRepoMock.update.mock.calls[0][1] as { metadata?: { bolt11?: string } }
    expect(updateArg.metadata?.bolt11).toBe('lnbc-req')
  })

  it('Phase 5 경로: 기존 metadata.bolt11 은 덮어쓰지 않는다', async () => {
    const { observer } = await load()
    const { opMap, txRepo, txRepoMock } = makeInjected({
      resolvedTxId: 'tx-mapped',
      existingTx: { id: 'tx-mapped', status: 'pending', metadata: { bolt11: 'lnbc-original' } },
    })
    observer.injectDependencies(opMap, txRepo)

    await observer.recordLightningReceive(RECEIVE_PARAMS)
    const updateArg = txRepoMock.update.mock.calls[0][1] as { metadata?: unknown }
    expect(updateArg.metadata).toBeUndefined()
  })

  it('이미 settled 인 TX 는 false — 재기록·재발화 없음 (idempotent)', async () => {
    const { observer, useAppStore } = await load()
    const { opMap, txRepo, txRepoMock } = makeInjected({
      resolvedTxId: 'tx-mapped',
      existingTx: { id: 'tx-mapped', status: 'settled', metadata: {} },
    })
    observer.injectDependencies(opMap, txRepo)

    const before = useAppStore.getState().txRefreshTrigger
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(false)
    expect(txRepoMock.update).not.toHaveBeenCalled()
    expect(useAppStore.getState().txRefreshTrigger).toBe(before)
    expect(broadcastSyncMock).not.toHaveBeenCalled()
  })

  it('매핑 없음 → 폴백: legacy repo 에 tx-{quoteId} 로 새 TX 생성', async () => {
    const { observer, useAppStore } = await load()
    const { opMap, txRepo } = makeInjected({ resolvedTxId: null })
    observer.injectDependencies(opMap, txRepo)

    const before = useAppStore.getState().txRefreshTrigger
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(true)
    expect(legacyRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tx-quote-1',
        direction: 'receive',
        type: 'lightning',
        amount: 21,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        metadata: { quoteId: 'quote-1' },
      }),
    )
    expect(useAppStore.getState().txRefreshTrigger).toBe(before + 1)
    expect(broadcastSyncMock).toHaveBeenCalledWith('balance_changed')
  })

  it('주입 자체가 없으면(과도기) 곧장 폴백 경로', async () => {
    const { observer } = await load()
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)
    expect(recorded).toBe(true)
    expect(legacyRepoMock.save).toHaveBeenCalled()
  })

  it('폴백도 idempotent: 기존 tx-{quoteId} 가 있으면 false, 부수효과 없음', async () => {
    const { observer } = await load()
    legacyRepoMock.findById.mockResolvedValue({ id: 'tx-quote-1' })

    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(false)
    expect(legacyRepoMock.save).not.toHaveBeenCalled()
    expect(broadcastSyncMock).not.toHaveBeenCalled()
  })
})

describe('connectMintQuoteObserver', () => {
  beforeEach(() => {
    legacyRepoMock.findById.mockReset().mockResolvedValue(null)
    legacyRepoMock.save.mockReset().mockResolvedValue(undefined)
    broadcastSyncMock.mockReset()
  })

  type FinalizedHandler = (event: {
    operation: { state: string; quoteId: string; amount: number; request?: string }
    mintUrl: string
  }) => Promise<void>

  function makeManager() {
    const handlers: Record<string, FinalizedHandler> = {}
    const unsub = vi.fn()
    const manager = {
      on: vi.fn((event: string, handler: FinalizedHandler) => {
        handlers[event] = handler
        return unsub
      }),
    }
    return { manager: manager as unknown as CashuRuntimeManager, handlers, unsub }
  }

  it('finalized 이벤트 → 거래 기록 (폴백 경로)', async () => {
    const { observer } = await load()
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    await handlers['mint-op:finalized']({
      operation: { state: 'finalized', quoteId: 'quote-live', amount: 5, request: 'lnbc-x' },
      mintUrl: 'https://mint.example.com',
    })

    expect(legacyRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tx-quote-live', amount: 5 }),
    )
  })

  it('swap quote 는 기록하지 않는다 (SwapService 가 별도 기록 — 이중 기록 방지)', async () => {
    const { observer, markQuoteAsSwap, unmarkQuoteAsSwap } = await load()
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    markQuoteAsSwap('quote-swap')
    try {
      await handlers['mint-op:finalized']({
        operation: { state: 'finalized', quoteId: 'quote-swap', amount: 5 },
        mintUrl: 'https://mint.example.com',
      })
      expect(legacyRepoMock.save).not.toHaveBeenCalled()
    } finally {
      unmarkQuoteAsSwap('quote-swap')
    }
  })

  it('finalized 가 아닌 상태는 무시', async () => {
    const { observer } = await load()
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    await handlers['mint-op:finalized']({
      operation: { state: 'pending', quoteId: 'quote-p', amount: 5 },
      mintUrl: 'https://mint.example.com',
    })

    expect(legacyRepoMock.save).not.toHaveBeenCalled()
  })

  it('기록 실패는 핸들러 안에서 소화된다 (unhandled rejection 금지)', async () => {
    const { observer } = await load()
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    legacyRepoMock.save.mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        handlers['mint-op:finalized']({
          operation: { state: 'finalized', quoteId: 'quote-err', amount: 5 },
          mintUrl: 'https://mint.example.com',
        }),
      ).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith(
        '[MintQuoteObserver] Failed to record transaction:',
        expect.any(Error),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('disconnect 시 구독 해제, connect 재호출 시 기존 구독 해제 후 재구독', async () => {
    const { observer } = await load()
    const { manager, unsub } = makeManager()

    observer.connectMintQuoteObserver(manager)
    observer.connectMintQuoteObserver(manager) // 재연결 — 기존 구독 해제
    expect(unsub).toHaveBeenCalledTimes(1)

    observer.disconnectMintQuoteObserver()
    expect(unsub).toHaveBeenCalledTimes(2)
  })
})
