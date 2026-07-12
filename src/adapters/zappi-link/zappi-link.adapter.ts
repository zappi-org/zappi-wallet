import { Ok, Err, type Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import { ZappiLinkRegistrationError, ZappiLinkApiError } from '@/core/errors/zappi-link'
import { ZAPPI_LINK_URL } from '@/core/constants'
import type {
  LightningAddressProvider,
  AddressResult,
  UsernameCheckResult,
  ProviderDefaults,
} from '@/core/ports/driven/lightning-address.port'

/** Zappi-link extended defaults */
export interface ZappiLinkDefaults extends ProviderDefaults {
  rateLimitBypassFee: number
}

/** NIP-98 auth token creator — injected to avoid coupling to NostrService */
export type Nip98AuthCreator = (privateKeyHex: string, url: string, method: string) => string

/**
 * zappi-link Lightning Address adapter
 *
 * Implements LightningAddressProvider via the zappi-link HTTP API.
 * NIP-98 authenticated registration and lookup.
 */
export class ZappiLinkAdapter implements LightningAddressProvider {
  private readonly baseUrl: string

  constructor(
    private readonly createNip98Token: Nip98AuthCreator,
    baseUrl?: string,
  ) {
    this.baseUrl = baseUrl ?? ZAPPI_LINK_URL
  }

  async registerAddress(nostrPrivkey: string): Promise<Result<AddressResult, BaseError>> {
    const url = `${this.baseUrl}/api/v1/address`

    try {
      const token = this.createNip98Token(nostrPrivkey, url, 'POST')

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Nostr ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return Err(new ZappiLinkApiError(response.status, body || 'Registration failed'))
      }

      const data: AddressResult = await response.json()
      return Ok(data)
    } catch (error) {
      return Err(new ZappiLinkRegistrationError('Failed to register Lightning Address', error))
    }
  }

  async getAddress(pubkey: string): Promise<Result<AddressResult | null, BaseError>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/address/${pubkey}`)

      if (response.status === 404) {
        return Ok(null)
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return Err(new ZappiLinkApiError(response.status, body || 'Address lookup failed'))
      }

      const data: AddressResult = await response.json()
      return Ok(data)
    } catch (error) {
      return Err(new ZappiLinkRegistrationError('Failed to lookup Lightning Address', error))
    }
  }

  async checkUsername(username: string): Promise<Result<UsernameCheckResult, BaseError>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/username/${encodeURIComponent(username)}`)

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return Err(new ZappiLinkApiError(response.status, body || 'Username check failed'))
      }

      const data: UsernameCheckResult = await response.json()
      return Ok(data)
    } catch (error) {
      return Err(new ZappiLinkRegistrationError('Failed to check username', error))
    }
  }

  async changeUsername(nostrPrivkey: string, username: string, cashuToken: string): Promise<Result<AddressResult, BaseError>> {
    const url = `${this.baseUrl}/api/v1/address`

    try {
      const token = this.createNip98Token(nostrPrivkey, url, 'POST')

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Nostr ${token}`,
          'Content-Type': 'application/json',
          'x-cashu': cashuToken,
        },
        body: JSON.stringify({ username }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return Err(new ZappiLinkApiError(response.status, body || 'Username change failed'))
      }

      const data: AddressResult = await response.json()
      return Ok(data)
    } catch (error) {
      return Err(new ZappiLinkRegistrationError('Failed to change username', error))
    }
  }

  async getDefaults(): Promise<Result<ProviderDefaults, BaseError>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/defaults`)

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return Err(new ZappiLinkApiError(response.status, body || 'Failed to fetch defaults'))
      }

      const data: ZappiLinkDefaults = await response.json()
      return Ok(data)
    } catch (error) {
      return Err(new ZappiLinkRegistrationError('Failed to fetch server defaults', error))
    }
  }
}
