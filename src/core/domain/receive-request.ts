/**
 * ReceiveRequest — 다중 결제 수단 통합 수신 요청 도메인 엔티티
 *
 * 여러 모듈(Lightning, Ecash)에서 생성된 결제 요청을 하나의 엔티티로 통합.
 * 어떤 경로로든 결제되면 동일한 ReceiveRequest가 완료 처리.
 */

import type { Amount } from './amount'

export type ReceiveRequestStatus = 'pending' | 'completed' | 'expired' | 'cancelled'

export interface PaymentMethod {
  readonly type: string
  readonly encoded: string
  readonly expiresAt: number
  readonly ref: string
  readonly metadata?: Record<string, unknown>
}

export interface ReceiveRequest {
  readonly id: string
  readonly amount: Amount
  readonly accountId: string     // mint URL
  readonly status: ReceiveRequestStatus
  readonly paymentMethods: readonly PaymentMethod[]
  readonly createdAt: number
  readonly expiresAt: number
  readonly bip321Uri?: string
  readonly completedMethod?: string
  readonly completedAt?: number
}

export function createReceiveRequest(
  params: Omit<ReceiveRequest, 'status' | 'createdAt'>,
): ReceiveRequest {
  return { ...params, status: 'pending', createdAt: Date.now() }
}

export function completeReceiveRequest(
  req: ReceiveRequest,
  method: string,
): ReceiveRequest {
  return { ...req, status: 'completed', completedMethod: method, completedAt: Date.now() }
}

export function expireReceiveRequest(req: ReceiveRequest): ReceiveRequest {
  return { ...req, status: 'expired' }
}

export function cancelReceiveRequest(req: ReceiveRequest): ReceiveRequest {
  return { ...req, status: 'cancelled' }
}

export function isExpired(req: ReceiveRequest): boolean {
  return req.status === 'pending' && req.expiresAt <= Date.now()
}
