import type { ReceiveRequest } from './receive-request'
import type { Transaction } from './transaction'

export function hiddenPendingReceiveTransactionRefs(receiveRequests: readonly ReceiveRequest[]): Set<string> {
  const hiddenRefs = new Set<string>()

  for (const request of receiveRequests) {
    if (request.fulfillmentStatus !== 'fulfilled') continue

    hiddenRefs.add(request.id)
    for (const method of request.paymentMethods) {
      if (method.status !== 'received') {
        hiddenRefs.add(method.ref)
      }
    }
  }

  return hiddenRefs
}

export function isVisibleTransaction(
  transaction: Transaction,
  hiddenReceiveRefs: ReadonlySet<string>,
): boolean {
  if (transaction.direction !== 'receive' || transaction.status !== 'pending') {
    return true
  }

  const quoteId = transaction.metadata?.quoteId
  return !hiddenReceiveRefs.has(transaction.id) &&
    (typeof quoteId !== 'string' || !hiddenReceiveRefs.has(quoteId))
}
