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

/** Token detail view status — pending includes created-but-unclaimed ecash tokens. */
export type TokenDetailStatus = 'pending' | 'registered' | 'consumed' | 'reclaimed'

export interface TokenFiatDisplay {
  amount: number
  currency: string
}

/** Data shape consumed by TokenDetailScreen. Independent of mock/production source. */
export interface TokenDetailData {
  id: string
  status: TokenDetailStatus
  amount: number
  memo?: string
  /** Creation timestamp (ms) — always present */
  createdAt: number
  /** Status-change timestamp (ms). For 'registered'/'reclaimed'. Falls back to createdAt if absent. */
  statusAt?: number
  /** Fee in sats — shown under amount for 'registered'/'reclaimed'. */
  fee?: number
  /** Fee in sats required to reclaim — shown inside the pending reclaim CTA. */
  reclaimFee?: number
  /** Mint info for the contextual mint row. */
  mintAlias: string
  mintName?: string
  mintIconUrl?: string
  /** Mint URL that issued the token — used for the raw sheet. */
  mintUrl?: string
  /** Cashu token string — used for QR/copy/share/raw sheet. */
  tokenString?: string
  /** Fiat display value — optional, shown inline after amount. */
  fiat?: TokenFiatDisplay
  /** Base unit (e.g. 'sat') — shown in raw sheet. */
  unit?: string
  /** Show orange "unread" dot on the pending title. */
  unread?: boolean
}
