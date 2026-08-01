export type PaymentReceiptStatus = 'printing' | 'finishing' | 'pending' | 'done'

export function shouldStartReceiptTorn(status: PaymentReceiptStatus, supportsPaperAnimation: boolean): boolean {
  return status === 'done' || status === 'pending' || (status === 'finishing' && !supportsPaperAnimation)
}
