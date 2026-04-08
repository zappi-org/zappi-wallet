import type {
  PaymentRequestUseCase,
  NostrPaymentRequestOptions,
  DualTransportPaymentRequestOptions,
  PaymentRequestResult,
  Poller,
} from '@/core/ports/driving/payment-request.usecase'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'

export class PaymentRequestService implements PaymentRequestUseCase {
  constructor(
    private readonly codec: TokenCodec,
    private readonly httpPollerFactory: (opts: {
      endpoint: string
      requestId: string
      intervalMs?: number
      maxDurationMs?: number
    }) => Poller,
  ) {}

  createNostrPaymentRequest(opts: NostrPaymentRequestOptions): PaymentRequestResult {
    return this.codec.createNostrPaymentRequest({
      amount: opts.amount,
      unit: opts.unit ?? 'sat',
      mints: opts.mints,
      p2pkPubkey: opts.p2pkPubkey,
      pubkey: opts.nostrTarget ?? opts.pubkey,
      relays: opts.relays,
      description: opts.description,
    })
  }

  createDualTransportPaymentRequest(opts: DualTransportPaymentRequestOptions): PaymentRequestResult {
    return this.codec.createDualTransportPaymentRequest({
      amount: opts.amount,
      unit: opts.unit ?? 'sat',
      mints: opts.mints,
      mintUrl: opts.mintUrl,
      p2pkPubkey: opts.p2pkPubkey,
      pubkey: opts.nostrTarget ?? opts.pubkey,
      relays: opts.relays,
      description: opts.description,
    })
  }

  buildUnifiedBitcoinUri(opts: { lightningInvoice: string; cashuRequest: string }): string {
    return this.codec.buildUnifiedBitcoinUri(opts)
  }

  startHttpPoller(opts: {
    endpoint: string
    requestId: string
    intervalMs?: number
    maxDurationMs?: number
  }): Poller {
    return this.httpPollerFactory(opts)
  }
}
