import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import type { AccountInfo, AliasResult, PaidQuote } from '@/core/ports/driven/payment-alias-provider.port'

export interface PaymentAliasUseCase {
  getAlias(privkey: string): Promise<Result<AccountInfo, BaseError>>
  registerAlias(privkey: string): Promise<Result<AliasResult, BaseError>>
  changeAlias(privkey: string, alias: string, cashuToken: string): Promise<Result<AliasResult, BaseError>>
  setMint(privkey: string, mintUrl: string): Promise<Result<void, BaseError>>
  toggleLock(privkey: string): Promise<Result<boolean, BaseError>>
  claimPaidQuotes(privkey: string): Promise<Result<PaidQuote[], BaseError>>
}
