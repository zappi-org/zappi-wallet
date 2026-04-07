import type { PendingItem } from '@/core/ports/driving/pending-items.usecase'

export interface ReceiveRequestDetails {
  quoteId: string
  invoice: string
  ecashRequest?: string
  ecashRequestId?: string
  bip321Uri?: string
  httpEndpoint?: string
}

export interface TokenDetails {
  token: string
  operationId?: string
}

export function isReceiveRequest(item: PendingItem): item is PendingItem<ReceiveRequestDetails> {
  return item.direction === 'receive' && item.kind === 'request'
}

export function isSendToken(item: PendingItem): item is PendingItem<TokenDetails> {
  return item.direction === 'send' && item.kind === 'token'
}

export function isOfflineToken(item: PendingItem): item is PendingItem<TokenDetails> {
  return item.direction === 'receive' && item.kind === 'token'
}
