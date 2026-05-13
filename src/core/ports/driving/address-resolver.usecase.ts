/**
 * AddressResolverUseCase — 주소 → 결제 수단 탐색 driving port
 */

import type { ContactAddressType } from '@/core/domain/contact'
import type { LnurlPayParams } from '@/core/ports/driven/lnurl-gateway.port'

export interface DirectTokenInfo {
  mints: string[]
  p2pkPubkey?: string
  dmRelays?: string[]
}

export interface PaymentCapabilities {
  address: string
  type: ContactAddressType
  pubkey?: string
  relays?: string[]
  capabilities: {
    directToken?: DirectTokenInfo
    lnurl?: LnurlPayParams
    bolt12?: { offer: string }
  }
}

export interface AddressResolverUseCase {
  resolve(address: string): Promise<PaymentCapabilities>
}
