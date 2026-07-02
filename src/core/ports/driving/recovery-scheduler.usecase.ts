/**
 * RecoveryScheduler — recoverAll(B1~B9 일괄 발화)의 행동 단위 분해 (설계 §6).
 *
 * 원칙: 복구(네트워크)와 정합(로컬 DB)을 분리하고, 트리거마다 필요한 행동만
 * 발화한다. 원격 정산 감지는 push(watcher/브리지)의 소관 — 여기의 네트워크
 * 행동은 push가 닿지 않는 Zappi 고유 큐(B7a stuck quote / B9 오프라인 토큰 /
 * B4 legacy send)로 한정된다.
 */

import type { RecoveryReport } from './payment.usecase'

/** 로컬 정합 보고 (설계 §6.2) */
export interface ReconcileReport {
  /** 거래DB settle 마킹 (B3 finalized + B6 이중망) */
  settled: number
  /** 거래DB reclaim 마킹 (B3 rolled_back) */
  reclaimed: number
  /** 거래DB 실패 마킹 (B5 만료/제거민트 + B7b 비추적 + 로컬 op failed) */
  failed: number
  /** B8 deleteExpired로 정리된 legacy 행 수 */
  cleaned: number
}

export interface RecoverySchedulerUseCase {
  /**
   * 로컬 전용 정합 (B3+B5+B6이중망+B7b+B8). 네트워크 0이 계약.
   * RequestGate('reconcile', 10s) — Token 탭 진입 등 고빈도 트리거용.
   */
  reconcile(): Promise<ReconcileReport>

  /**
   * Zappi 고유 네트워크 구제 (B7a requeuePaidMintQuotes + B9 오프라인 토큰 +
   * B4 legacy send). RequestGate('recovery:targeted', 5분/실패 30초) —
   * cooldown 내 재호출은 직전 보고서를 반환한다. bypassGate는 AddMint 직후처럼
   * "지금 반드시 실행"이 의도인 1회성 호출 전용.
   */
  recoverTargeted(opts?: { bypassGate?: boolean }): Promise<RecoveryReport>

  /**
   * 민트 신뢰 시점의 review-queue 상환 (설계 §6.3 AddMint [N3]).
   * 해당 민트로 온 대기 review를 자동 redeem — 민트를 명시적으로 신뢰하는
   * 순간이 곧 사용자 승인이다. 반환 amount(sat)가 "복구액" UI의 원천.
   * 영구 실패(TOKEN_SPENT류)는 큐에서 제거, 일시 오류는 잔류.
   */
  drainReviewQueue(mintUrl: string): Promise<{ redeemed: number; amount: number }>

  /**
   * Settings 복구 버튼 전용 — gate 미적용(사용자 명시 의도), in-flight 공유만.
   * Coco sweep 전종(B1/B2 포함, inProgress면 skip [N7]) + targeted 내용(gate
   * 우회) + reconcile. 현재지갑 restore(민트별 wallet.restore)는 기존대로
   * recoverAccounts가 담당 — 별도 액션.
   */
  runFullNetworkRecovery(): Promise<RecoveryReport>
}
