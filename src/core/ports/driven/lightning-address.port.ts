import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

/** Lightning Address registration result */
export interface AddressResult {
  address: string
  username: string
  npub: string
  isCustom: boolean
}

/** Username availability check */
export interface UsernameCheckResult {
  available: boolean
  reason?: string
}

/** Provider-agnostic server defaults (LUD-06 compatible) */
export interface ProviderDefaults {
  mintUrl: string
  relays: string[]
  acceptedMints: string[]
  addressFee: number
  minSendable: number
  maxSendable: number
}

/**
 * Lightning Address hosting provider.
 *
 * Abstracts the registration and management of Lightning Addresses
 * so the implementation (zappi-link, LNbits, self-hosted, etc.) can be swapped.
 */
export interface LightningAddressProvider {
  registerAddress(nostrPrivkey: string): Promise<Result<AddressResult, BaseError>>
  getAddress(pubkey: string): Promise<Result<AddressResult | null, BaseError>>
  checkUsername(username: string): Promise<Result<UsernameCheckResult, BaseError>>
  changeUsername(nostrPrivkey: string, username: string, cashuToken: string): Promise<Result<AddressResult, BaseError>>
  getDefaults(): Promise<Result<ProviderDefaults, BaseError>>
}
