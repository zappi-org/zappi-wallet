/**
 * ReceiveRequest — multi-method receive lifecycle.
 *
 * Request fulfillment is separate from each payment method state:
 * - fulfillmentStatus decides whether the request is still shown as pending.
 * - paymentMethods[].status records what happened to each rail independently.
 */

import type { Amount } from './amount'

export type FulfillmentStatus = 'pending' | 'fulfilled' | 'expired' | 'cancelled'
export type MethodStatus = 'active' | 'received' | 'expired'
export type ReceivePaymentMethodType = 'bolt11' | 'ecash'

export type LegacyReceiveRequestStatus = 'pending' | 'completed' | 'expired' | 'cancelled'
export type ReceiveRequestStatus = FulfillmentStatus

export interface PaymentMethod {
  readonly type: ReceivePaymentMethodType
  readonly status: MethodStatus
  readonly encoded: string
  readonly expiresAt: number
  readonly ref: string
  readonly receivedAt?: number
  readonly metadata?: Record<string, unknown>
}

export interface ReceiveRequest {
  readonly id: string
  readonly amount: Amount
  readonly accountId: string     // mint URL
  readonly fulfillmentStatus: FulfillmentStatus
  readonly paymentMethods: readonly PaymentMethod[]
  readonly createdAt: number
  readonly expiresAt: number
  readonly bip321Uri?: string
  readonly fulfilledBy?: ReceivePaymentMethodType
  readonly fulfilledAt?: number
}

export function normalizeReceivePaymentMethodType(method: string): ReceivePaymentMethodType | null {
  if (method === 'bolt11' || method === 'lightning') return 'bolt11'
  if (method === 'ecash' || method === 'nostr-gift-wrap') return 'ecash'
  return null
}

export function legacyStatusFromFulfillment(status: FulfillmentStatus): LegacyReceiveRequestStatus {
  if (status === 'fulfilled') return 'completed'
  return status
}

export function fulfillmentFromLegacyStatus(status: LegacyReceiveRequestStatus): FulfillmentStatus {
  if (status === 'completed') return 'fulfilled'
  return status
}

export function createReceiveMethod(
  params: Omit<PaymentMethod, 'status'> & { status?: MethodStatus },
): PaymentMethod {
  return { ...params, status: params.status ?? 'active' }
}

export function createReceiveRequest(
  params: Omit<ReceiveRequest, 'fulfillmentStatus'> & {
    fulfillmentStatus?: FulfillmentStatus
  },
): ReceiveRequest {
  return {
    ...params,
    fulfillmentStatus: params.fulfillmentStatus ?? 'pending',
    paymentMethods: params.paymentMethods.map((method) => createReceiveMethod(method)),
  }
}

export function fulfillByMethod(
  req: ReceiveRequest,
  method: ReceivePaymentMethodType,
  now: number,
): ReceiveRequest {
  if (req.fulfillmentStatus === 'cancelled' || req.fulfillmentStatus === 'expired') {
    return req
  }

  const { paymentMethods, changed } = markMethodReceived(req.paymentMethods, method, now)
  if (!changed) return req

  if (req.fulfillmentStatus === 'fulfilled') {
    return { ...req, paymentMethods }
  }

  return {
    ...req,
    fulfillmentStatus: 'fulfilled',
    fulfilledBy: method,
    fulfilledAt: now,
    paymentMethods,
  }
}

export function receiveAdditionalMethod(
  req: ReceiveRequest,
  method: ReceivePaymentMethodType,
  now: number,
): ReceiveRequest {
  if (req.fulfillmentStatus !== 'fulfilled') {
    return fulfillByMethod(req, method, now)
  }

  const { paymentMethods, changed } = markMethodReceived(req.paymentMethods, method, now)
  return changed ? { ...req, paymentMethods } : req
}

export function completeReceiveRequest(
  req: ReceiveRequest,
  method: ReceivePaymentMethodType,
  now: number,
): ReceiveRequest {
  return req.fulfillmentStatus === 'fulfilled'
    ? receiveAdditionalMethod(req, method, now)
    : fulfillByMethod(req, method, now)
}

export function expireMethod(
  req: ReceiveRequest,
  method: ReceivePaymentMethodType,
  now: number,
): ReceiveRequest {
  let changed = false
  const paymentMethods = req.paymentMethods.map((paymentMethod) => {
    if (paymentMethod.type !== method || paymentMethod.status !== 'active') return paymentMethod
    changed = true
    return { ...paymentMethod, status: 'expired' as const }
  })

  if (!changed) return req
  return finalizeExpiry({ ...req, paymentMethods }, now)
}

export function expireMethodsByTime(req: ReceiveRequest, now: number): ReceiveRequest {
  let changed = false
  const paymentMethods = req.paymentMethods.map((method) => {
    if (method.status !== 'active' || method.expiresAt > now) return method
    changed = true
    return { ...method, status: 'expired' as const }
  })

  if (!changed) return req
  return finalizeExpiry({ ...req, paymentMethods }, now)
}

export function expireReceiveRequest(req: ReceiveRequest, now: number): ReceiveRequest {
  if (req.fulfillmentStatus === 'fulfilled') {
    return expireMethodsByTime(req, now)
  }

  return {
    ...req,
    fulfillmentStatus: 'expired',
    paymentMethods: req.paymentMethods.map((method) =>
      method.status === 'active' ? { ...method, status: 'expired' as const } : method,
    ),
  }
}

export function cancelReceiveRequest(req: ReceiveRequest): ReceiveRequest {
  if (req.fulfillmentStatus === 'fulfilled') return req

  return {
    ...req,
    fulfillmentStatus: 'cancelled',
    paymentMethods: req.paymentMethods.map((method) =>
      method.status === 'active' ? { ...method, status: 'expired' as const } : method,
    ),
  }
}

export function isPending(req: ReceiveRequest): boolean {
  return req.fulfillmentStatus === 'pending'
}

export function isExpired(req: ReceiveRequest, now: number): boolean {
  return req.fulfillmentStatus === 'pending' && req.expiresAt <= now
}

function markMethodReceived(
  paymentMethods: readonly PaymentMethod[],
  method: ReceivePaymentMethodType,
  now: number,
): { paymentMethods: readonly PaymentMethod[]; changed: boolean } {
  let changed = false
  const next = paymentMethods.map((paymentMethod) => {
    if (paymentMethod.type !== method || paymentMethod.status === 'received') {
      return paymentMethod
    }
    changed = true
    return { ...paymentMethod, status: 'received' as const, receivedAt: now }
  })

  return { paymentMethods: changed ? next : paymentMethods, changed }
}

function finalizeExpiry(req: ReceiveRequest, now: number): ReceiveRequest {
  if (req.fulfillmentStatus !== 'pending') return req
  if (req.paymentMethods.some((method) => method.status === 'active' && method.expiresAt > now)) return req
  return { ...req, fulfillmentStatus: 'expired' }
}
