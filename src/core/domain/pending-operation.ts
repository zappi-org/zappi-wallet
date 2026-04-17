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
  readonly metadata?: Record<string, unknown>
}

export function isExpired(op: PendingOperation, maxAgeMs: number): boolean {
  return Date.now() - op.createdAt > maxAgeMs
}
