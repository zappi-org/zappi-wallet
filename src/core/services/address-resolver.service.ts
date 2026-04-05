/**
 * AddressResolverService — 주소 → 결제 수단 탐색 (ZAP-146)
 *
 * email / npub / nprofile / bolt12 주소를 받아
 * NutZap, NUT-18, LNURL 등 사용 가능한 결제 수단을 반환.
 */

import type { ContactAddressType } from '@/core/domain/contact'
import type { NostrFilter } from '@/core/domain/nostr'
import type { LnurlPayParams } from '@/core/ports/driven/lnurl-gateway.port'
import type { Nip05Resolver } from '@/core/ports/driven/nip05-resolver.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { PaymentCapabilities, DirectTokenInfo } from '@/core/ports/driving/address-resolver.usecase'
import { npubDecode, nprofileDecode } from '@/core/domain/nostr-address'
import { parseNutZapInfo } from '@/core/domain/nutzap'

// Re-export for backward compatibility
export type { PaymentCapabilities, DirectTokenInfo }

// ─── Service ───

export class AddressResolverService {
  constructor(
    private readonly nip05: Nip05Resolver,
    private readonly nostr: Pick<NostrGateway, 'queryEvents'>,
    private readonly lnurl: Pick<LnurlGateway, 'resolvePay'>,
  ) {}

  async resolve(address: string): Promise<PaymentCapabilities> {
    const type = detectType(address)

    switch (type) {
      case 'email':
        return this.resolveEmail(address)
      case 'npub':
        return this.resolveNpub(address)
      case 'nprofile':
        return this.resolveNprofile(address)
      case 'bolt12':
        return { address, type, capabilities: { bolt12: { offer: address } } }
    }
  }

  private async resolveEmail(address: string): Promise<PaymentCapabilities> {
    const nip05Result = await this.nip05.resolve(address)
    if (!nip05Result) {
      return this.resolveEmailLnurlOnly(address)
    }

    const { pubkey, relays } = nip05Result
    const [directToken, lnurl] = await Promise.all([
      this.fetchDirectTokenInfo(pubkey),
      this.resolveLnurl(address),
    ])

    return {
      address,
      type: 'email',
      pubkey,
      relays: relays.length > 0 ? relays : undefined,
      capabilities: compact({ directToken, lnurl }),
    }
  }

  private async resolveEmailLnurlOnly(address: string): Promise<PaymentCapabilities> {
    const lnurl = await this.resolveLnurl(address)
    return { address, type: 'email', capabilities: compact({ lnurl }) }
  }

  private async resolveNpub(address: string): Promise<PaymentCapabilities> {
    const pubkey = npubDecode(address)
    const directToken = await this.fetchDirectTokenInfo(pubkey)

    return {
      address,
      type: 'npub',
      pubkey,
      capabilities: compact({ directToken }),
    }
  }

  private async resolveNprofile(address: string): Promise<PaymentCapabilities> {
    const { pubkey, relays } = nprofileDecode(address)
    const directToken = await this.fetchDirectTokenInfo(pubkey)

    return {
      address,
      type: 'nprofile',
      pubkey,
      relays,
      capabilities: compact({ directToken }),
    }
  }

  private async fetchDirectTokenInfo(pubkey: string): Promise<DirectTokenInfo | undefined> {
    const filter: NostrFilter = { kinds: [10019], authors: [pubkey], limit: 1 }
    const events = await this.nostr.queryEvents([filter])
    if (events.length === 0) return undefined

    const info = parseNutZapInfo(events[0])
    if (info.mints.length === 0) return undefined
    return { mints: info.mints, p2pkPubkey: info.p2pkPubkey }
  }

  private async resolveLnurl(address: string): Promise<LnurlPayParams | undefined> {
    try {
      return await this.lnurl.resolvePay(address)
    } catch {
      return undefined
    }
  }
}

// ─── Helpers ───

function detectType(address: string): ContactAddressType {
  if (address.startsWith('npub1')) return 'npub'
  if (address.startsWith('nprofile1')) return 'nprofile'
  if (address.startsWith('lno1') || address.startsWith('lno1q')) return 'bolt12'
  if (address.includes('@')) return 'email'
  throw new Error(`Unknown address type: ${address}`)
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (result as Record<string, unknown>)[k] = v
  }
  return result
}
