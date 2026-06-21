import type { PaymentDeliveryPort } from '@/core/ports/driven/payment-delivery.port'
import type { OutgoingPaymentTransport } from '@/core/ports/driven/outgoing-payment-transport.port'
import { sendTokenViaHttp, type PaymentTokenDecoder } from '@/adapters/codec/nut18-http-poller'

export class PaymentDelivery implements PaymentDeliveryPort {
  constructor(
    private readonly outgoingTransport: OutgoingPaymentTransport,
    private readonly decodeToken: PaymentTokenDecoder,
  ) {}

  async deliverToken(params: Parameters<PaymentDeliveryPort['deliverToken']>[0]) {
    const { token, parsedRequest, memo } = params

    if (!parsedRequest) {
      return { success: true, transportUsed: 'none' as const }
    }

    if (parsedRequest.hasNostrTransport && parsedRequest.nostrTarget) {
      try {
        const result = await this.outgoingTransport.send({
          recipientPubkey: parsedRequest.nostrTarget,
          token,
          memo,
          requestId: parsedRequest.id,
        })
        if (result.success) {
          return { success: true, transportUsed: 'nostr' as const }
        }
      } catch (error) {
        console.warn('[PaymentDelivery] Nostr delivery failed, trying HTTP fallback:', error)
      }
    }

    if (parsedRequest.hasPostTransport && parsedRequest.postTarget) {
      try {
        const result = await sendTokenViaHttp({
          endpoint: parsedRequest.postTarget,
          token,
          requestId: parsedRequest.id,
          memo,
          decodeToken: this.decodeToken,
        })
        if (result.success) {
          return { success: true, transportUsed: 'post' as const }
        }
      } catch (error) {
        console.warn('[PaymentDelivery] HTTP delivery failed:', error)
      }
    }

    if (!parsedRequest.hasNostrTransport && !parsedRequest.hasPostTransport) {
      return { success: true, transportUsed: 'none' as const }
    }

    return { success: false, transportUsed: 'none' as const }
  }
}
