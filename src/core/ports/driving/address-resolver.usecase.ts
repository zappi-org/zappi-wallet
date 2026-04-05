/**
 * AddressResolverUseCase — 주소 → 결제 수단 탐색 driving port
 */

import type { PaymentCapabilities } from '@/core/services/address-resolver.service'

export interface AddressResolverUseCase {
  resolve(address: string): Promise<PaymentCapabilities>
}
