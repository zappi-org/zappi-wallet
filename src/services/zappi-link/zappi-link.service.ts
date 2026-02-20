import { ok, err, type Result } from '@/core/types'
import { type BaseError } from '@/core/errors/base'
import { ZappiLinkRegistrationError, ZappiLinkApiError } from '@/core/errors/zappi-link'
import { ZAPPI_LINK_URL } from '@/core/constants'
import type { NostrService } from '@/services/nostr/nostr.service'

/**
 * Address registration result from zappi-link API
 */
export interface AddressResult {
  address: string
  username: string
  npub: string
  isCustom: boolean
}

/**
 * Username availability check result
 */
export interface UsernameCheckResult {
  available: boolean
  reason?: string
}

/**
 * Server defaults from /api/v1/defaults
 */
export interface ServerDefaults {
  mintUrl: string
  relays: string[]
  acceptedMints: string[]
  addressFee: number
  rateLimitBypassFee: number
  minSendable: number
  maxSendable: number
}

/**
 * Service interface for zappi-link Lightning Address operations
 */
export interface IZappiLinkService {
  registerAddress(nostrPrivkey: string): Promise<Result<AddressResult, BaseError>>
  getAddress(pubkey: string): Promise<Result<AddressResult | null, BaseError>>
  getDefaults(): Promise<Result<ServerDefaults, BaseError>>
  checkUsername(username: string): Promise<Result<UsernameCheckResult, BaseError>>
  changeUsername(nostrPrivkey: string, username: string, cashuToken: string): Promise<Result<AddressResult, BaseError>>
}

/**
 * zappi-link Lightning Address service
 *
 * Handles NIP-98 authenticated registration and lookup via the zappi-link API.
 * Registration flow:
 * 1. Create NIP-98 auth token (kind 27235) signed with wallet's Nostr key
 * 2. POST /api/v1/address → server derives deterministic BIP-39 username from pubkey
 * 3. Server reads Kind 10019 from relays for mint/relay/P2PK info
 */
export class ZappiLinkService implements IZappiLinkService {
  private readonly baseUrl: string

  constructor(
    private readonly nostrService: NostrService,
    baseUrl?: string
  ) {
    this.baseUrl = baseUrl ?? ZAPPI_LINK_URL
  }

  /**
   * Register a new Lightning Address via NIP-98 auth
   * If address already exists for this pubkey, returns the existing one.
   */
  async registerAddress(nostrPrivkey: string): Promise<Result<AddressResult, BaseError>> {
    const url = `${this.baseUrl}/api/v1/address`

    try {
      const token = this.nostrService.createNip98AuthToken(nostrPrivkey, url, 'POST')

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
        return err(new ZappiLinkApiError(response.status, body || 'Registration failed'))
      }

      const data: AddressResult = await response.json()
      return ok(data)
    } catch (error) {
      return err(new ZappiLinkRegistrationError('Failed to register Lightning Address', error))
    }
  }

  /**
   * Check if a Lightning Address exists for this pubkey (public endpoint, no auth)
   * Returns null if no address found (404).
   */
  async getAddress(pubkey: string): Promise<Result<AddressResult | null, BaseError>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/address/${pubkey}`)

      if (response.status === 404) {
        return ok(null)
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return err(new ZappiLinkApiError(response.status, body || 'Address lookup failed'))
      }

      const data: AddressResult = await response.json()
      return ok(data)
    } catch (error) {
      return err(new ZappiLinkRegistrationError('Failed to lookup Lightning Address', error))
    }
  }

  /**
   * Check username availability (public endpoint, no auth)
   */
  async checkUsername(username: string): Promise<Result<UsernameCheckResult, BaseError>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/username/${encodeURIComponent(username)}`)

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return err(new ZappiLinkApiError(response.status, body || 'Username check failed'))
      }

      const data: UsernameCheckResult = await response.json()
      return ok(data)
    } catch (error) {
      return err(new ZappiLinkRegistrationError('Failed to check username', error))
    }
  }

  /**
   * Get server defaults (public endpoint, no auth)
   * Returns fee, accepted mints, and other config.
   */
  async getDefaults(): Promise<Result<ServerDefaults, BaseError>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/defaults`)

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return err(new ZappiLinkApiError(response.status, body || 'Failed to fetch defaults'))
      }

      const data: ServerDefaults = await response.json()
      return ok(data)
    } catch (error) {
      return err(new ZappiLinkRegistrationError('Failed to fetch server defaults', error))
    }
  }

  /**
   * Change to a custom username with Cashu payment
   */
  async changeUsername(nostrPrivkey: string, username: string, cashuToken: string): Promise<Result<AddressResult, BaseError>> {
    const url = `${this.baseUrl}/api/v1/address`

    try {
      const token = this.nostrService.createNip98AuthToken(nostrPrivkey, url, 'POST')

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
        return err(new ZappiLinkApiError(response.status, body || 'Username change failed'))
      }

      const data: AddressResult = await response.json()
      return ok(data)
    } catch (error) {
      return err(new ZappiLinkRegistrationError('Failed to change username', error))
    }
  }
}
