/**
 * RecoverySchedulerService — recoverAll 행동 분해 실행기 (설계 §6.2)
 *
 * 핵심 불변식:
 * - reconcile은 로컬 정합 함수만 부른다 (네트워크 행동 미발화)
 * - recoverTargeted는 5분 gate — cooldown 내 재호출은 직전 보고서, bypassGate는 즉시 실행
 * - drain: 성공→resolve, 토큰 소비 코드→discard, 그 외(UNTRUSTED_MINT류)→잔류
 * - full: sweep→targeted 내용→reconcile 조합, 연타는 in-flight 공유
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecoverySchedulerService, type RecoverySchedulerDeps } from '@/core/services/recovery-scheduler.service'
import { Ok, Err } from '@/core/domain/result'
import type { PendingIncomingReview } from '@/core/types'
import type { BaseError } from '@/core/errors/base'

function makeError(code: string, retryable: boolean): BaseError {
  return { code, message: code, isRetryable: retryable, name: code } as unknown as BaseError
}

function makeReview(id: string): PendingIncomingReview {
  return {
    externalId: id,
    token: {
      type: 'cashu-token',
      token: `cashuA-${id}`,
      amount: { value: 10n, unit: 'sat' },
      mintUrl: 'https://mint.test',
    },
    queuedAt: 1,
    source: 'gift-wrap',
  }
}

function makeDeps(overrides: Partial<RecoverySchedulerDeps> = {}) {
  const deps = {
    reconcileCashu: vi.fn().mockResolvedValue({ settled: 1, reclaimed: 2, failed: 3, cleaned: 4 }),
    requeuePaidQuotes: vi.fn().mockResolvedValue({ requeued: ['q1'] }),
    redeemOfflineTokens: vi.fn().mockResolvedValue({ redeemed: 2, failed: 0 }),
    recoverLegacySends: vi.fn().mockResolvedValue({ reclaimed: 1, recorded: 5 }),
    runCocoSweeps: vi.fn().mockResolvedValue({ ran: ['send'], skipped: [] }),
    reviewQueue: {
      enqueue: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
      listByMint: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
    },
    redeemToken: vi.fn().mockResolvedValue(Ok({ amount: { value: 10n, unit: 'sat' as const } })),
    resolveReview: vi.fn().mockResolvedValue(undefined),
    discardReview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies RecoverySchedulerDeps
  return deps
}

describe('RecoverySchedulerService', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  describe('reconcile', () => {
    it('runs only the local reconcile action — no network behaviors fire', async () => {
      const deps = makeDeps()
      const scheduler = new RecoverySchedulerService(deps)

      const report = await scheduler.reconcile()

      expect(report).toEqual({ settled: 1, reclaimed: 2, failed: 3, cleaned: 4 })
      expect(deps.requeuePaidQuotes).not.toHaveBeenCalled()
      expect(deps.redeemOfflineTokens).not.toHaveBeenCalled()
      expect(deps.recoverLegacySends).not.toHaveBeenCalled()
      expect(deps.runCocoSweeps).not.toHaveBeenCalled()
    })

    it('absorbs rapid re-entry through the 10s gate (stale return)', async () => {
      const deps = makeDeps()
      const scheduler = new RecoverySchedulerService(deps)

      await scheduler.reconcile()
      await scheduler.reconcile()

      expect(deps.reconcileCashu).toHaveBeenCalledTimes(1)
    })
  })

  describe('recoverTargeted', () => {
    it('fires B7a+B9+B4 and counts recovered per legacy convention', async () => {
      const deps = makeDeps()
      const scheduler = new RecoverySchedulerService(deps)

      const report = await scheduler.recoverTargeted()

      // requeued(1) + offline redeemed(2) + legacy reclaimed(1) — recorded는 계수 제외
      expect(report).toEqual({ moduleId: 'cashu', recovered: 4, failed: 0 })
    })

    it('returns the cached report within the 5m cooldown, bypassGate re-runs', async () => {
      const deps = makeDeps()
      const scheduler = new RecoverySchedulerService(deps)

      await scheduler.recoverTargeted()
      await scheduler.recoverTargeted()
      expect(deps.requeuePaidQuotes).toHaveBeenCalledTimes(1)

      await scheduler.recoverTargeted({ bypassGate: true })
      expect(deps.requeuePaidQuotes).toHaveBeenCalledTimes(2)
    })

    it('a failed sub-action degrades the report instead of rejecting', async () => {
      const deps = makeDeps({
        requeuePaidQuotes: vi.fn().mockRejectedValue(new Error('mint down')),
      })
      const scheduler = new RecoverySchedulerService(deps)

      const report = await scheduler.recoverTargeted()

      expect(report.recovered).toBe(3) // offline 2 + legacy 1
      expect(report.failed).toBe(1)
    })
  })

  describe('drainReviewQueue', () => {
    it('redeems queued reviews for the mint and resolves them', async () => {
      const reviews = [makeReview('a'), makeReview('b')]
      const deps = makeDeps({
        reviewQueue: {
          enqueue: vi.fn(),
          listAll: vi.fn().mockResolvedValue([]),
          listByMint: vi.fn().mockResolvedValue(reviews),
          remove: vi.fn(),
        },
      })
      const scheduler = new RecoverySchedulerService(deps)

      const result = await scheduler.drainReviewQueue('https://mint.test')

      expect(deps.reviewQueue.listByMint).toHaveBeenCalledWith('https://mint.test')
      expect(result).toEqual({ redeemed: 2, amount: 20 })
      expect(deps.resolveReview).toHaveBeenCalledTimes(2)
      expect(deps.discardReview).not.toHaveBeenCalled()
    })

    it('discards only token-consumed failures; environmental errors stay queued', async () => {
      const reviews = [makeReview('spent'), makeReview('untrusted'), makeReview('flaky')]
      const deps = makeDeps({
        reviewQueue: {
          enqueue: vi.fn(),
          listAll: vi.fn().mockResolvedValue([]),
          listByMint: vi.fn().mockResolvedValue(reviews),
          remove: vi.fn(),
        },
        redeemToken: vi
          .fn()
          .mockResolvedValueOnce(Err(makeError('TOKEN_SPENT', false)))
          // 토큰은 멀쩡한데 환경이 원인 — isRetryable=false여도 폐기 금지
          .mockResolvedValueOnce(Err(makeError('UNTRUSTED_MINT', false)))
          .mockResolvedValueOnce(Err(makeError('NETWORK_ERROR', true))),
      })
      const scheduler = new RecoverySchedulerService(deps)

      const result = await scheduler.drainReviewQueue('https://mint.test')

      expect(result).toEqual({ redeemed: 0, amount: 0 })
      expect(deps.discardReview).toHaveBeenCalledTimes(1)
      expect(deps.discardReview).toHaveBeenCalledWith(reviews[0], 'TOKEN_SPENT')
      expect(deps.resolveReview).not.toHaveBeenCalled()
    })

    it('a redeem throw skips that review without aborting the drain', async () => {
      const reviews = [makeReview('boom'), makeReview('ok')]
      const deps = makeDeps({
        reviewQueue: {
          enqueue: vi.fn(),
          listAll: vi.fn().mockResolvedValue([]),
          listByMint: vi.fn().mockResolvedValue(reviews),
          remove: vi.fn(),
        },
        redeemToken: vi
          .fn()
          .mockRejectedValueOnce(new Error('crash'))
          .mockResolvedValueOnce(Ok({ amount: { value: 7n, unit: 'sat' as const } })),
      })
      const scheduler = new RecoverySchedulerService(deps)

      const result = await scheduler.drainReviewQueue('https://mint.test')

      expect(result).toEqual({ redeemed: 1, amount: 7 })
    })
  })

  describe('runFullNetworkRecovery', () => {
    it('composes sweeps + targeted content + reconcile into one report', async () => {
      const deps = makeDeps()
      const scheduler = new RecoverySchedulerService(deps)

      const report = await scheduler.runFullNetworkRecovery()

      expect(deps.runCocoSweeps).toHaveBeenCalledTimes(1)
      expect(deps.reconcileCashu).toHaveBeenCalledTimes(1)
      // targeted(4) + reconcile settled(1)+reclaimed(2) / failed: targeted 0 + reconcile 3
      expect(report).toEqual({ moduleId: 'cashu', recovered: 7, failed: 3 })
    })

    it('shares one in-flight run across button mashing (no gate cooldown)', async () => {
      let release!: (v: { ran: string[]; skipped: string[] }) => void
      const deps = makeDeps({
        runCocoSweeps: vi.fn().mockImplementation(
          () => new Promise((resolve) => { release = resolve }),
        ),
      })
      const scheduler = new RecoverySchedulerService(deps)

      const first = scheduler.runFullNetworkRecovery()
      const second = scheduler.runFullNetworkRecovery()
      release({ ran: [], skipped: [] })
      await Promise.all([first, second])

      expect(deps.runCocoSweeps).toHaveBeenCalledTimes(1)

      // cooldown 0 — 종료 후 재호출은 새로 실행된다 (사용자 명시 의도)
      const third = scheduler.runFullNetworkRecovery()
      release({ ran: [], skipped: [] })
      await third
      expect(deps.runCocoSweeps).toHaveBeenCalledTimes(2)
    })

    it('does not consume the targeted gate (unlock 직후 targeted가 막히지 않는다)', async () => {
      const deps = makeDeps()
      const scheduler = new RecoverySchedulerService(deps)

      await scheduler.runFullNetworkRecovery()
      await scheduler.recoverTargeted()

      // full 1회 + targeted 1회 = 2회 (gate가 공유됐다면 1회였을 것)
      expect(deps.requeuePaidQuotes).toHaveBeenCalledTimes(2)
    })
  })
})
