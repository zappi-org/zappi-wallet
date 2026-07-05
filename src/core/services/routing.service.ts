import type { RoutingUseCase } from '@/core/ports/driving/routing.usecase'
import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'
import { RequestGate } from '@/core/utils/request-gate'
import {
  type PaymentRoute,
  type RouteInput,
  type FeeEstimate,
  selectRoute as domainSelectRoute,
  findCommonMints as domainFindCommonMints,
} from '@/core/domain/routing'

export class RoutingService implements RoutingUseCase {
  /**
   * 견적 캐시 (설계 §8.4 FeeEstimationService): 키 (route, source, target,
   * amount[, invoice]) TTL 60s + in-flight 공유. my-wallet/크로스민트 견적은
   * 타겟 민트에 실제 quote를 만들고 지우는 4왕복이라, SendFlow→ConfirmStep
   * 재진입·같은 금액 재시도의 중복 왕복을 흡수한다.
   * 정직한 범위 [N4][N10]: 키에 amount가 포함되므로 금액을 바꿔가며 편집하면
   * 매번 원 왕복이 유지된다 — 확실한 이득은 동일 조합 재진입뿐.
   * 실패 쿨다운 5s: 견적 실패 직후의 즉시 재시도 폭주만 막고, 사용자 재시도는
   * 빠르게 허용한다.
   */
  private readonly estimateGate = new RequestGate({ cooldownMs: 60_000, failureCooldownMs: 5_000 })

  constructor(private readonly feeEstimator: FeeEstimator) {}

  selectRoute(input: RouteInput): PaymentRoute {
    return domainSelectRoute(input)
  }

  findCommonMints(senderMints: string[], receiverMints: string[]): string[] {
    return domainFindCommonMints(senderMints, receiverMints)
  }

  async estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate> {
    // invoice는 결제 단위 식별자 — 같은 인보이스의 재견적만 캐시를 공유한다
    const key = `route:${route}:${sourceMint}:${targetMint ?? ''}:${amount}:${invoice ?? ''}`
    const { value } = await this.estimateGate.run(key, () =>
      this.feeEstimator.estimateRouteFee(route, sourceMint, amount, targetMint, invoice),
    )
    return value
  }

}
