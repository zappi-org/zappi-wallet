export interface IncomingPaymentResult {
  status: 'success' | 'already_processed' | 'failed'
  amount?: number
  error?: string
}

export interface IncomingPaymentUseCase {
  processIncoming(params: {
    adapterId: string
    payload: string
    externalId: string
    memo?: string
    metadata?: Record<string, unknown>
  }): Promise<IncomingPaymentResult>
}
