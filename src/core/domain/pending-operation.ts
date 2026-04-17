import type { Amount } from './amount'

/**
 * 결제 어댑터가 시작했으나 아직 완료되지 않은 연산.
 * kind는 어댑터가 자유롭게 정의 (예: 'melt', 'send-token', 'htlc', 'vtxo').
 * 어댑터 고유 필드(token, operationRef 등)는 도메인에 포함하지 않는다.
 */
export interface PendingOperation {
  readonly id: string
  readonly kind: string
  readonly accountId: string
  readonly amount: Amount
  readonly createdAt: number
  /**
   * Protocol-neutral expiry (ms epoch).
   * The adapter picks the earliest applicable expiry from its own protocol.
   * undefined = no notion of expiry (e.g. bolt12 offer).
   */
  readonly expiresAt?: number
  readonly metadata?: Record<string, unknown>
}

/** Protocol-neutral expiry check. Items without `expiresAt` are treated as non-expiring. */
export function isExpired(item: { expiresAt?: number }, now: number = Date.now()): boolean {
  return item.expiresAt != null && item.expiresAt <= now
}
