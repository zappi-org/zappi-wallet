import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import type { ClaimResult, ClaimStorageMode } from '@/core/ports/driven/payment-alias-provider.port'

export interface ClaimStorageUseCase {
  getBalance(privkey: string): Promise<Result<number, BaseError>>
  getClaim(privkey: string): Promise<Result<ClaimResult, BaseError>>
  getClaimStorageMode(privkey: string): Promise<Result<ClaimStorageMode, BaseError>>
  setClaimStorageMode(privkey: string, mode: ClaimStorageMode): Promise<Result<ClaimStorageMode, BaseError>>
}
