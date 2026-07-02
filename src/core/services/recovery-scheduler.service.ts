/**
 * RecoverySchedulerService — recoverAll의 행동 단위 분해 실행기 (설계 §6)
 *
 * 모든 행동은 함수 주입(DI)으로 받는다 — 이 서비스는 모듈 구현을 모르고,
 * "무엇을 언제 발화하는가"(게이팅·조합·보고)만 소유한다. Coco/모듈 배선은
 * bootstrap이 한다.
 */

import { toNumber, type Amount } from '@/core/domain/amount'
import { RequestGate } from '@/core/utils/request-gate'
import type {
  ReconcileReport,
  RecoverySchedulerUseCase,
} from '@/core/ports/driving/recovery-scheduler.usecase'
import type { RecoveryReport } from '@/core/ports/driving/payment.usecase'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { PendingIncomingReview } from '@/core/types'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface RecoverySchedulerDeps {
  /** B3+B5+B6이중망+B7b+B8 — 로컬 정합 (네트워크 0) */
  reconcileCashu(): Promise<ReconcileReport>
  /** B7a — Coco 추적 중 stuck PAID quote 재실행 */
  requeuePaidQuotes(): Promise<{ requeued: string[] }>
  /** B9 — 오프라인 수신 토큰 상환 */
  redeemOfflineTokens(): Promise<{ redeemed: number; failed: number }>
  /** B4 — legacy(무operationId) send 토큰 self-receive */
  recoverLegacySends(): Promise<{ reclaimed: number; recorded: number }>
  /** B1/B2 포함 Coco recovery sweep 전종 (inProgress면 skip [N7]) — full 전용 */
  runCocoSweeps(): Promise<{ ran: string[]; skipped: string[] }>
  /** drain의 원천 큐 */
  reviewQueue: IncomingReviewQueue
  /** drain redeem — payment.redeem 축소 표면 */
  redeemToken(input: string): Promise<Result<{ amount: Amount }, BaseError>>
  /** drain 성공 후처리 — processedStore success 마킹 + 연결 request 완료 + 큐 제거 + ACK */
  resolveReview(review: PendingIncomingReview): Promise<void>
  /** drain 영구 실패 후처리 — processedStore skipped 마킹 + 큐 제거 */
  discardReview(review: PendingIncomingReview, reason: string): Promise<void>
}

/**
 * drain에서 큐를 종결해도 되는 실패 — "토큰 자체가 소비/무효"인 경우만.
 * offline-token-recovery(B9)와 동일 정책. isRetryable=false 전체를 쓰지 않는
 * 이유: UNTRUSTED_MINT처럼 토큰은 멀쩡한데 환경이 원인인 비재시도 오류가
 * 사용자 결정 전의 review를 폐기해 버리면 자금 손실이다.
 */
const PERMANENT_TOKEN_ERROR_CODES = new Set(['TOKEN_SPENT', 'INVALID_TOKEN', 'INVALID_PROOF'])

export class RecoverySchedulerService implements RecoverySchedulerUseCase {
  /** 고빈도 트리거(Token 탭 등) 흡수 — 설계 §6.4 키 'reconcile' */
  private readonly reconcileGate = new RequestGate({ cooldownMs: 10_000, failureCooldownMs: 10_000 })
  /** 네트워크 구제의 상한 — 설계 §6.4 키 'recovery:targeted' */
  private readonly targetedGate = new RequestGate({ cooldownMs: 5 * 60_000, failureCooldownMs: 30_000 })
  /** full은 gate 없음(사용자 명시 의도) — 연타 시 in-flight 공유만 */
  private readonly fullGate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 0 })

  constructor(private readonly deps: RecoverySchedulerDeps) {}

  async reconcile(): Promise<ReconcileReport> {
    const { value } = await this.reconcileGate.run('reconcile', () => this.deps.reconcileCashu())
    return value
  }

  async recoverTargeted(opts?: { bypassGate?: boolean }): Promise<RecoveryReport> {
    if (opts?.bypassGate) {
      return this.runTargeted()
    }
    const { value } = await this.targetedGate.run('recovery:targeted', () => this.runTargeted())
    return value
  }

  async drainReviewQueue(mintUrl: string): Promise<{ redeemed: number; amount: number }> {
    const reviews = await this.deps.reviewQueue.listByMint(mintUrl)
    let redeemed = 0
    let amount = 0

    for (const review of reviews) {
      try {
        const result = await this.deps.redeemToken(review.token.token)
        if (result.ok) {
          redeemed++
          amount += toNumber(result.value.amount)
          await this.deps.resolveReview(review)
        } else if (PERMANENT_TOKEN_ERROR_CODES.has(result.error.code)) {
          // 토큰이 이미 소비/무효 — 재시도 무의미, 큐 종결
          await this.deps.discardReview(review, result.error.message)
        }
        // 그 외(일시 오류·환경 원인): 큐 잔류 — 다음 drain/사용자 확인 모달이 재시도
      } catch (error) {
        console.error('[RecoveryScheduler] drain redeem failed:', review.externalId, error)
      }
    }

    return { redeemed, amount }
  }

  async runFullNetworkRecovery(): Promise<RecoveryReport> {
    const { value } = await this.fullGate.run('recovery:full', async () => {
      // 1. Coco sweep 전종 (B1/B2/receive/mint — inProgress면 개별 skip)
      const sweeps = await this.deps.runCocoSweeps()
      console.log(`[RecoveryScheduler] Coco sweeps ran=[${sweeps.ran}] skipped=[${sweeps.skipped}]`)

      // 2. targeted 내용 (gate 우회 — 여기서만 직접 실행, 중복 방지)
      const targeted = await this.runTargeted()

      // 3. 로컬 정합 마무리 (gate 우회 — full의 결과를 즉시 거래DB에 반영)
      const rec = await this.deps.reconcileCashu()

      return {
        moduleId: targeted.moduleId,
        recovered: targeted.recovered + rec.settled + rec.reclaimed,
        failed: targeted.failed + rec.failed,
      } satisfies RecoveryReport
    })
    return value
  }

  /** B7a + B9 + B4 — gate 없이 실제 실행 (recoverTargeted/full이 감싼다) */
  private async runTargeted(): Promise<RecoveryReport> {
    const [requeue, offline, legacy] = await Promise.allSettled([
      this.deps.requeuePaidQuotes(),
      this.deps.redeemOfflineTokens(),
      this.deps.recoverLegacySends(),
    ])

    const requeued = requeue.status === 'fulfilled' ? requeue.value.requeued.length : 0
    const off = offline.status === 'fulfilled' ? offline.value : { redeemed: 0, failed: 1 }
    const leg = legacy.status === 'fulfilled' ? legacy.value : { reclaimed: 0, recorded: 0 }

    // 기존 recoverPending 계수 규약 유지: recovered = 실제 자금 회수 건수
    return {
      moduleId: 'cashu',
      recovered: requeued + off.redeemed + leg.reclaimed,
      failed: off.failed + (requeue.status === 'rejected' ? 1 : 0) + (legacy.status === 'rejected' ? 1 : 0),
    }
  }
}
