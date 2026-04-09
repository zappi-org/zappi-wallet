/**
 * Nip05ResolverAdapter — NIP-05 identity resolver
 *
 * HTTP fetch로 /.well-known/nostr.json 조회.
 * 외부 라이브러리 불필요 — fetch API만 사용.
 */

import type { Nip05Resolver, Nip05Result } from '@/core/ports/driven/nip05-resolver.port'

interface Nip05Response {
  names?: Record<string, string>
  relays?: Record<string, string[]>
}

export class Nip05ResolverAdapter implements Nip05Resolver {
  private readonly timeout: number

  constructor(options?: { timeout?: number }) {
    this.timeout = options?.timeout ?? 5000
  }

  async resolve(address: string): Promise<Nip05Result | null> {
    const parsed = parseAddress(address)
    if (!parsed) return null

    const url = `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeout),
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) return null

      const data: Nip05Response = await response.json()

      if (!data.names || !data.names[parsed.name]) return null

      const pubkey = data.names[parsed.name]
      const relays = data.relays?.[pubkey] ?? []

      return { pubkey, relays }
    } catch {
      return null
    }
  }
}

function parseAddress(address: string): { name: string; domain: string } | null {
  const parts = address.split('@')
  if (parts.length !== 2) return null
  const [name, domain] = parts
  if (!name || !domain) return null
  return { name, domain }
}
