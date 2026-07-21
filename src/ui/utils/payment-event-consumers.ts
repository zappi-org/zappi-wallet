/**
 * payment-event-consumers — module-level coordination for payment:completed UI.
 *
 * When a full-screen UI (e.g. Send/DirectReceiptStep) is active for a specific
 * transaction, it "owns" the UX feedback for that tx's completion event. The
 * global `useGlobalTokenClaimToast` subscriber checks ownership and skips its
 * toast, so the user doesn't see a redundant notification on top of the
 * dedicated screen.
 *
 * Lifecycle is managed by the owning component's mount/unmount (via `useOwnPaymentEvent`).
 */

const owned = new Set<string>()

export function markPaymentOwnedByUI(txId: string): void {
  owned.add(txId)
}

export function unmarkPaymentOwnedByUI(txId: string): void {
  owned.delete(txId)
}

export function isPaymentOwnedByUI(txId: string): boolean {
  return owned.has(txId)
}
