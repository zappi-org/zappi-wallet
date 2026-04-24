import type { Amount } from '@/core/domain/amount'
import type { FulfillmentStatus, ReceivePaymentMethodType } from '@/core/domain/receive-request'

export interface CreateReceiveRequestParams {
  accountId: string
  amount: Amount
  description?: string
  requestId?: string
  quoteId?: string
  bolt11?: string
  ecashRequest?: string
  ecashRequestId?: string
  httpEndpoint?: string
  bip321Uri?: string
  expiresAt?: number
}

export interface ReceiveRequestData {
  id: string
  accountId: string
  amount: number
  fulfillmentStatus: FulfillmentStatus
  quoteId?: string
  bolt11?: string
  httpEndpoint?: string
  createdAt: number
  fulfilledAt?: number
  fulfilledBy?: ReceivePaymentMethodType
}

export interface ReceiveRequestUseCase {
  create(params: CreateReceiveRequestParams): Promise<ReceiveRequestData>
  complete(id: string, method: string): Promise<void>
  settleByPaymentRef(paymentRef: string, method: string): Promise<ReceiveRequestData | null>
  cancel(id: string): Promise<void>
  findByQuoteId(quoteId: string): Promise<ReceiveRequestData | null>
  findByRequestId(requestId: string): Promise<ReceiveRequestData | null>
  getPending(accountIds?: string[]): Promise<ReceiveRequestData[]>
  cleanupExpired(): Promise<number>
}
