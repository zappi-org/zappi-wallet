import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface AuthSession {
  token: string
  expiresAt: number
}

export interface AccountInfo {
  alias: string | null
  domain: string
  mintUrl: string
  lockQuote: boolean
}

export interface AliasResult {
  alias: string
  npub: string
}

export interface PaidQuote {
  quoteId: string
  amount: number
  mintUrl: string
  unit: string
  paidAt: number
  expiry: number
}

export interface PaymentAliasProvider {
  authenticate(signer: import('./nostr-signer.port').NostrSigner): Promise<Result<AuthSession, BaseError>>
  getAccountInfo(session: AuthSession): Promise<Result<AccountInfo, BaseError>>
  purchaseAlias(session: AuthSession, alias: string, cashuToken: string): Promise<Result<AliasResult, BaseError>>
  setPreferredMint(session: AuthSession, mintUrl: string): Promise<Result<void, BaseError>>
  toggleLock(session: AuthSession): Promise<Result<boolean, BaseError>>
  getPaidQuotes(session: AuthSession, since?: number): Promise<Result<PaidQuote[], BaseError>>
  subscribePaidQuotes(
    signer: import('./nostr-signer.port').NostrSigner,
    onQuoteId: (quoteId: string) => void,
    onDisconnect?: () => void,
  ): Promise<Result<() => void, BaseError>>
}
