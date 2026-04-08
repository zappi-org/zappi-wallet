import type { Amount } from '@/core/domain/amount'

export interface CreateReceiveRequestParams {
  accountId: string
  adapterId: string
  amount: Amount
  description?: string
  requestId?: string
  quoteId?: string
  bolt11?: string
  ecashRequest?: string
  ecashRequestId?: string
  httpEndpoint?: string
  bip321Uri?: string
}

export interface ReceiveRequestData {
  id: string
  accountId: string
  adapterId: string
  amount: number
  status: 'pending' | 'completed' | 'expired' | 'cancelled'
  quoteId?: string
  bolt11?: string
  httpEndpoint?: string
  createdAt: number
  completedAt?: number
}

export interface ReceiveRequestUseCase {
  create(params: CreateReceiveRequestParams): Promise<ReceiveRequestData>
  complete(id: string, method: string): Promise<void>
  cancel(id: string): Promise<void>
  findByQuoteId(quoteId: string): Promise<ReceiveRequestData | null>
  findByRequestId(requestId: string): Promise<ReceiveRequestData | null>
  getPending(accountIds?: string[]): Promise<ReceiveRequestData[]>
  cleanupExpired(): Promise<number>
}
