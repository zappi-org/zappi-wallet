import type { ParsedCashuRequest } from '@/core/domain/input-types'

export interface PaymentDeliveryPort {
  deliverToken(params: {
    token: string
    parsedRequest?: ParsedCashuRequest
    memo?: string
  }): Promise<{
    success: boolean
    transportUsed: 'nostr' | 'post' | 'none'
  }>
}
