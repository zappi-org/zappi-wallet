export type TransferDirection = 'outgoing' | 'incoming'

export type TransferPhase =
  | 'preparing'
  | 'submitted'
  | 'in_transit'
  | 'awaiting_confirmation'
  | 'settled'
  | 'failed'
  | 'recoverable'

export type FinalityModel =
  | 'immediate'
  | 'deferred'
  | 'revocable'

export type ExpiryAction = 'fail' | 'reclaim' | 'expire'

export interface PendingTransfer {
  readonly id: string
  readonly txId: string
  readonly direction: TransferDirection

  readonly phase: TransferPhase
  readonly finality: FinalityModel

  readonly expiresAt?: number
  readonly onExpiry: ExpiryAction

  /** Adapter reads protocol data (domain is opaque) */
  readonly transportRef: unknown

  readonly createdAt: number
  readonly updatedAt: number

  readonly amount?: number
}

export function createPendingTransfer(params: {
  id: string
  txId: string
  direction: TransferDirection
  finality: FinalityModel
  onExpiry: ExpiryAction
  expiresAt?: number
  transportRef: unknown
  now: number
  amount?: number
}): PendingTransfer {
  return {
    ...params,
    phase: 'preparing',
    createdAt: params.now,
    updatedAt: params.now,
  }
}

/**
 * phase 전이 (감사 Phase 4 독립 항목 — 구현은 FinalityModel 인지 최소 가드).
 *
 * 수용: 현행 정당 전이 전부 — preparing→settled(즉시 melt), submitted→settled
 * (immediate finality), recoverable→settled(reclaim), 임의 비종단 간 이동,
 * failed→submitted(재시도 계열). 새 phase 도입 없음.
 *
 * 거부: settled → (settled 외 전부). settled 는 "자금이 전달됨"의 기록이다 —
 * 어떤 코드 경로(늦은 watcher 이벤트, 중복 confirm, 복구 sweep 경합)도 이를
 * 미정산·실패로 되돌려선 안 된다. settled→failed 도 거부(후속 라운드 조이기 —
 * 합법 롤백 수요 없음이 호출부 전수로 확인됨; 유일 도달 경로였던 중복 incoming
 * 재처리는 processIncomingTransfer 의 isTerminal 조기 반환으로 차단). 역행은
 * 이중 지출/이중 표시 버그의 은폐가 되므로 무음 무시가 아니라 throw 로 표면화한다.
 */
export function transitionPhase(
  transfer: PendingTransfer,
  newPhase: TransferPhase,
  now: number,
): PendingTransfer {
  if (transfer.phase === 'settled' && newPhase !== 'settled') {
    throw new Error(
      `Illegal phase transition: settled → ${newPhase} (transfer ${transfer.id})`,
    )
  }
  return { ...transfer, phase: newPhase, updatedAt: now }
}

export function isTerminal(phase: TransferPhase): boolean {
  return phase === 'settled' || phase === 'failed'
}

export function canReclaim(
  transfer: Pick<PendingTransfer, 'phase' | 'onExpiry'>,
): boolean {
  return transfer.phase === 'recoverable' && transfer.onExpiry === 'reclaim'
}

export function isExpired(transfer: PendingTransfer, now: number = Date.now()): boolean {
  return transfer.expiresAt != null && transfer.expiresAt <= now
}

/** Incoming transfer가 claim 가능한 상태인지 확인 */
export function canComplete(
  transfer: Pick<PendingTransfer, 'phase' | 'direction'>,
): boolean {
  return transfer.direction === 'incoming' && transfer.phase === 'awaiting_confirmation'
}

