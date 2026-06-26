export interface NostrPaymentRequestOptions {
  amount: number
  unit?: string
  mints: string[]
  nostrTarget: string
  p2pkPubkey?: string
  pubkey?: string
  relays?: string[]
  description?: string
  singleUse?: boolean
  idPrefix?: string
}

export interface DualTransportPaymentRequestOptions extends NostrPaymentRequestOptions {
  mintUrl: string
}

export interface PaymentRequestResult {
  request: string
  id: string
  httpEndpoint?: string
}

export interface Poller {
  stop(): void
  onPayment(cb: (payload: { token: string; requestId: string; memo?: string }) => void): void
  onError(cb: (error: Error) => void): void
}

export interface PaymentRequestUseCase {
  createNostrPaymentRequest(opts: NostrPaymentRequestOptions): PaymentRequestResult
  createDualTransportPaymentRequest(opts: DualTransportPaymentRequestOptions): PaymentRequestResult
  buildUnifiedBitcoinUri(opts: { lightningInvoice: string; cashuRequest: string }): string
  startHttpPoller(opts: {
    endpoint: string
    requestId: string
    intervalMs?: number
    maxDurationMs?: number
    expiresAt?: number
  }): Poller
}
