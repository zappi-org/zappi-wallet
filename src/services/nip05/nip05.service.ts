import { ok, err, type Result } from '@/core/types'
import { Nip05LookupError, type BaseError } from '@/core/errors'
import { TIMEOUTS } from '@/core/constants'

/**
 * NIP-05 lookup result
 */
export interface Nip05Info {
  pubkey: string
  relays: string[]
}

/**
 * Parsed NIP-05 identifier
 */
export interface ParsedIdentifier {
  name: string
  domain: string
}

/**
 * NIP-05 response format
 */
interface Nip05Response {
  names?: Record<string, string>
  relays?: Record<string, string[]>
}

/**
 * Service for NIP-05 lookups
 * https://github.com/nostr-protocol/nips/blob/master/05.md
 */
export class Nip05Service {
  /**
   * Lookup a NIP-05 identifier
   * @param identifier user@domain.com format
   */
  async lookup(identifier: string): Promise<Result<Nip05Info, BaseError>> {
    const parsed = this.parseIdentifier(identifier)
    if (!parsed) {
      return err(new Nip05LookupError(identifier))
    }

    const { name, domain } = parsed
    const url = this.buildNip05Url(domain, name)

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUTS.RELAY_CONNECTION),
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        return err(new Nip05LookupError(identifier))
      }

      const data: Nip05Response = await response.json()

      if (!data.names || !data.names[name]) {
        return err(new Nip05LookupError(identifier))
      }

      const pubkey = data.names[name]
      const relays = data.relays?.[pubkey] ?? []

      return ok({ pubkey, relays })
    } catch (error) {
      return err(new Nip05LookupError(identifier, error))
    }
  }

  /**
   * Lookup only relays from a domain (using _ as name)
   */
  async lookupRelaysOnly(domain: string): Promise<Result<string[], BaseError>> {
    const result = await this.lookup(`_@${domain}`)
    if (result.isErr()) {
      return err(result.error)
    }
    return ok(result.value.relays)
  }

  /**
   * Parse a NIP-05 identifier into name and domain
   */
  parseIdentifier(identifier: string): ParsedIdentifier | null {
    const parts = identifier.split('@')
    if (parts.length !== 2) {
      return null
    }

    const [name, domain] = parts
    if (!name || !domain) {
      return null
    }

    return { name, domain }
  }

  /**
   * Build the NIP-05 lookup URL
   */
  buildNip05Url(domain: string, name: string): string {
    return `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`
  }
}
