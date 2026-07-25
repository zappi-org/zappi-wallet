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

    // No request at all = bearer token the sender hands over themselves; there is
    // nothing to deliver, so that is a success.
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

    // A request that declares no transport we can drive is a failed delivery, not
    // a silent success: reporting "sent" would hand the payer a receipt for a
    // token nobody received, while the funds stay committed.
    return { success: false, transportUsed: 'none' as const }
  }
}
