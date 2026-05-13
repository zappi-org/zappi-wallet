import type { ValidatedCashuRequest } from '@/core/domain/input-types'
import { findCommonMints } from '@/core/domain/routing'
import type { AddressResolverUseCase } from '@/core/ports/driving/address-resolver.usecase'
import type {
  NostrDirectPaymentResolution,
  NostrDirectPaymentUseCase,
} from '@/core/ports/driving/nostr-direct-payment.usecase'

export class NostrDirectPaymentService implements NostrDirectPaymentUseCase {
  constructor(private readonly addressResolver: AddressResolverUseCase) {}

  async resolve(params: {
    address: string
    ownMintUrls: string[]
    selectedMintUrl?: string | null
  }): Promise<NostrDirectPaymentResolution> {
    const address = params.address.trim()
    const result = await this.addressResolver.resolve(address)
    const directToken = result.capabilities.directToken

    if (!directToken || directToken.mints.length === 0) {
      return { status: 'no-info' }
    }

    if (!directToken.dmRelays || directToken.dmRelays.length === 0) {
      return { status: 'no-relay' }
    }

    const commonMintUrls = findCommonMints(params.ownMintUrls, directToken.mints)
    if (commonMintUrls.length === 0) {
      return { status: 'no-common-mint' }
    }

    const validatedData: ValidatedCashuRequest = {
      type: 'cashu-request',
      request: address,
      parsed: {
        id: `direct-${crypto.randomUUID()}`,
        unit: 'sat',
        mints: directToken.mints,
        transports: [{ type: 'nostr', target: address }],
        hasNostrTransport: true,
        nostrTarget: address,
        hasPostTransport: false,
        p2pkPubkey: directToken.p2pkPubkey,
        sameMintOnly: true,
      },
    }

    if (params.selectedMintUrl && containsMint(commonMintUrls, params.selectedMintUrl)) {
      return {
        status: 'ready',
        validatedData,
        commonMintUrls,
        selectedMintUrl: params.selectedMintUrl,
      }
    }

    return {
      status: 'needs-mint-selection',
      validatedData,
      commonMintUrls,
    }
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}

function containsMint(mints: string[], mintUrl: string): boolean {
  const normalized = normalizeUrl(mintUrl)
  return mints.some((mint) => normalizeUrl(mint) === normalized)
}
