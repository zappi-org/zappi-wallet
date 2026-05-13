export interface RouteExecutionStore {
  savePendingMelt(params: {
    quoteId: string
    mintUrl: string
    amount: number
    fee: number
    destination?: string
  }): Promise<void>
  deletePendingMelt(quoteId: string): Promise<void>
  savePendingSendToken(params: {
    id: string
    token: string
    mintUrl: string
    amount: number
    operationId: string
  }): Promise<void>
}
