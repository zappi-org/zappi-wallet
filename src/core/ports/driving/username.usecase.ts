import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import type {
  AddressResult,
  UsernameCheckResult,
  ProviderDefaults,
} from '@/core/ports/driven/lightning-address.port'

export type { AddressResult, UsernameCheckResult, ProviderDefaults }

export interface UsernameUseCase {
  checkUsername(username: string): Promise<Result<UsernameCheckResult, BaseError>>
  changeUsername(
    nostrPrivkey: string,
    username: string,
    cashuToken: string,
  ): Promise<Result<AddressResult, BaseError>>
  registerAddress(nostrPrivkey: string): Promise<Result<AddressResult, BaseError>>
  getAddress(pubkey: string): Promise<Result<AddressResult | null, BaseError>>
  getDefaults(): Promise<Result<ProviderDefaults, BaseError>>
}
