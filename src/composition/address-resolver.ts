/**
 * Composition root for AddressResolverService
 */

import { AddressResolverService } from '@/core/services/address-resolver.service'
import type { Nip05Resolver } from '@/core/ports/driven/nip05-resolver.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'

export function createAddressResolver(
  nip05: Nip05Resolver,
  nostr: Pick<NostrGateway, 'queryEvents'>,
  lnurl: Pick<LnurlGateway, 'resolvePay'>,
): AddressResolverService {
  return new AddressResolverService(nip05, nostr, lnurl)
}
