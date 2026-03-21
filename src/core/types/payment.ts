/**
 * Payment method
 */
export type PaymentMethod = 'lightning' | 'ecash'

/**
 * Mint quote for receiving Lightning payment
 */
export interface MintQuote {
  quoteId: string
  mintUrl: string
  amount: number
  request: string // bolt11 invoice
  state: 'UNPAID' | 'PAID' | 'ISSUED' | 'EXPIRED'
  expiry: number
}

/**
 * Melt quote for sending Lightning payment
 */
export interface MeltQuote {
  quoteId: string
  mintUrl: string
  amount: number
  feeReserve: number
  request: string // bolt11 invoice to pay
  state: 'UNPAID' | 'PENDING' | 'PAID' | 'EXPIRED'
  expiry: number
}

/**
 * NUT-18/NUT-26 Payment request
 */
export interface PaymentRequest {
  id: string
  amount: number
  unit: string
  mints: string[]
  description?: string
  singleUse: boolean
  p2pkPubkey?: string
  encoded: string // creqB... (NUT-26 bech32m) or creqA... (legacy CBOR)
}

/**
 * Receive flow state
 */
export interface ReceiveState {
  method: PaymentMethod
  amount: number
  status: 'idle' | 'creating' | 'waiting' | 'receiving' | 'completed' | 'failed'
  mintUrl?: string
  quote?: MintQuote
  paymentRequest?: PaymentRequest
  error?: string
}

/**
 * Send flow state
 */
export interface SendState {
  method: PaymentMethod
  amount: number
  status: 'idle' | 'creating' | 'sending' | 'completed' | 'failed'
  mintUrl?: string
  quote?: MeltQuote
  token?: string // cashuB... format for ecash
  error?: string
}

/**
 * Lightning address info from LNURL
 */
export interface LightningAddressInfo {
  address: string
  domain: string
  minSendable: number
  maxSendable: number
  commentAllowed?: number
  callback: string
  tag: 'payRequest'
}

/**
 * NutZap received event
 */
export interface NutZapEvent {
  id: string
  eventId: string
  senderPubkey: string
  recipientPubkey: string
  token: string
  amount: number
  mintUrl: string
  comment?: string
  createdAt: number
  txId: string
}
