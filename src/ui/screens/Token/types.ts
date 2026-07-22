/**
 * Pending ecash token view model.
 * Cashu tokens are bearer — no counterparty is recorded.
 * Fiat value is computed live from current rate, not stored.
 */
export interface PendingTokenView {
  id: string
  createdAt: number
  amount: number
  memo: string
  mintUrl?: string
  tokenString?: string
  /** Reclaim fee in sats, fetched via payment.quoteReclaim. Undefined while loading. */
  reclaimFee?: number
}
