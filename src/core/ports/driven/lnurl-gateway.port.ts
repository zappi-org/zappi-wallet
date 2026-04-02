// ─── Pay (LUD-06, LUD-16) ───

export interface LnurlPayParams {
  callback: string
  minSendable: number
  maxSendable: number
  metadata: string
  commentAllowed?: number
  tag: 'payRequest'
  domain: string
  allowsNostr?: boolean
  nostrPubkey?: string
  payerData?: Record<string, unknown>
}

export interface LnurlPayResult {
  bolt11?: string
  bolt12offer?: string
  successAction?: LnurlSuccessAction
  verify?: string
}

export interface LnurlSuccessAction {
  tag: 'message' | 'url' | 'aes'
  message?: string
  description?: string
  url?: string
  ciphertext?: string
  iv?: string
}

// ─── Withdraw (LUD-03) ───

export interface LnurlWithdrawParams {
  callback: string
  k1: string
  minWithdrawable: number
  maxWithdrawable: number
  defaultDescription: string
  domain: string
}

export interface LnurlWithdrawResult {
  status: 'OK' | 'ERROR'
  reason?: string
}

// ─── Auth (LUD-04) ───

export interface LnurlAuthParams {
  callback: string
  k1: string
  domain: string
  action?: 'register' | 'login' | 'link' | 'auth'
}

export interface LnurlAuthResult {
  status: 'OK' | 'ERROR'
  reason?: string
}

// ─── Pay Endpoint hosting (서버 필요) ───

export interface LnurlPayEndpointParams {
  username: string
  minSendable: number
  maxSendable: number
  metadata: string
}

// ─── Gateway ───

export interface LnurlGateway {
  // Pay — LUD-06, LUD-16 (Lightning Address → invoice)
  resolvePay(address: string): Promise<LnurlPayParams>
  fetchInvoice(
    params: LnurlPayParams,
    amountSats: number,
    options?: { comment?: string },
  ): Promise<LnurlPayResult>

  // Withdraw — LUD-03
  parseWithdraw?(url: string): Promise<LnurlWithdrawParams>
  executeWithdraw?(
    params: LnurlWithdrawParams,
    bolt11: string,
  ): Promise<LnurlWithdrawResult>

  // Auth — LUD-04
  parseAuth?(url: string): Promise<LnurlAuthParams>
  authenticate?(
    params: LnurlAuthParams,
    signature: string,
    publicKey: string,
  ): Promise<LnurlAuthResult>

  // Pay endpoint hosting — 서버 위임
  hostPayEndpoint?(params: LnurlPayEndpointParams): Promise<string>
}
