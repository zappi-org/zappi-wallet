export interface IncomingPaymentResult {
  status: 'success' | 'already_processed' | 'failed'
  amount?: number
  fee?: number
  error?: string
  /** True when the incoming payment matched (and settled) a ReceiveRequest the user created. */
  requestFulfilled?: boolean
}

export interface IncomingPaymentUseCase {
  processIncoming(params: {
    payload: string
    externalId: string
    memo?: string
    metadata?: Record<string, unknown>
    receiveRequestPaymentRef?: string
    receiveRequestMethod?: string
  }): Promise<IncomingPaymentResult>
}
