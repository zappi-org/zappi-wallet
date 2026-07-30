import type { ReceiveRequest } from './receive-request'
import type { Transaction } from './transaction'

// A receive request's per-method transaction rows are projections of the
// aggregate, not receives in their own right. Until a method actually
// receives, its projection stays hidden — the request item is the single
// visible face of an open request, and expiry/cancellation must not leave
// phantom pending/failed rows behind.
export function hiddenPendingReceiveTransactionRefs(receiveRequests: readonly ReceiveRequest[]): Set<string> {
  const hiddenRefs = new Set<string>()

  for (const request of receiveRequests) {
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
  // Settled receives are real money movements and always show; only unsettled
  // (pending/failed) receive rows can be request projections.
  if (transaction.direction !== 'receive' || transaction.status === 'settled') {
    return true
  }

  const quoteId = transaction.metadata?.quoteId
  return !hiddenReceiveRefs.has(transaction.id) &&
    (typeof quoteId !== 'string' || !hiddenReceiveRefs.has(quoteId))
}
