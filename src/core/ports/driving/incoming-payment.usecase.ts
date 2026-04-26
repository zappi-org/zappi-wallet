export interface IncomingPaymentResult {
  status: 'success' | 'already_processed' | 'failed'
  amount?: number
  fee?: number
  error?: string
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
