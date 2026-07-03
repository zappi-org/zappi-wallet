export interface RouteLockingCondition {
  kind: 'P2PK'
  data: string
  tags?: string[][]
}

export interface PreparedRouteMelt {
  operationId: string
  quoteId: string
  amount: number
  feeReserve: number
  swapFee: number
}

export interface ExecutedRouteMelt {
  preimage?: string
  effectiveFee?: number
}

export interface PreparedRouteTokenSend {
  operationId: string
  fee: number
}

export interface RouteMintQuote {
  quote: string
  request: string
}

export interface ParsedCreRequest {
  amount: number
  unit: string
  mints: string[]
}

export interface RoutePaymentOperator {
  createMintQuote(mintUrl: string, amount: number): Promise<RouteMintQuote>
  markMintQuoteAsSwap(quoteId: string): void
  unmarkMintQuoteAsSwap(quoteId: string): void
  prepareMelt(mintUrl: string, invoice: string): Promise<PreparedRouteMelt>
  executeMelt(operationId: string): Promise<ExecutedRouteMelt>
  rollbackMelt(operationId: string, reason: string): Promise<void>
  redeemMintQuote(mintUrl: string, quoteId: string, amount: number): Promise<void>
  mintAndReceive(quoteId: string, mintUrl: string, amount: number): Promise<void>
  prepareTokenSend(params: {
    mintUrl: string
    amount: number
    lockingCondition?: RouteLockingCondition
  }): Promise<PreparedRouteTokenSend>
  executeTokenSend(operationId: string, options?: { memo?: string }): Promise<{ token: string }>
  rollbackTokenSend(operationId: string): Promise<void>
  parsePaymentRequest(encodedRequest: string): Promise<ParsedCreRequest>
}
