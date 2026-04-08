// ZAP-02 Message Types (NIP-17 encrypted)

export interface ZapPaymentRequest {
  zap: '02'
  type: 'payment_request'
  content: {
    tx_id: string
    quote_id: string
    mint_url: string
    amount: number
    unit: string
    method: 'bolt11'
    expiry?: number
  }
}

export interface ZapPaymentFulfillment {
  zap: '02'
  type: 'payment_fulfillment'
  content: {
    tx_id: string
    token: string
    status: 'success'
  }
}

export type ZapMessage = ZapPaymentRequest | ZapPaymentFulfillment
