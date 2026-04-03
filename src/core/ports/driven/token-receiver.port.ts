export interface TokenReceiveResult {
  amount: number
  transactionId: string
}

export interface TokenReceiveError {
  code: string
  message: string
  isRetryable: boolean
}

export interface TokenReceiver {
  receiveToken(token: string): Promise<
    { ok: true; value: TokenReceiveResult } |
    { ok: false; error: TokenReceiveError }
  >
}
