/**
 * Pending mint quote — Lightning receive 대기 중인 결제 요청
 */
export interface PendingQuote {
  quoteId: string
  mintUrl: string
  amount: number
  invoice: string
  expiry: number
}
