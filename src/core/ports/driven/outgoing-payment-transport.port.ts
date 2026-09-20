/**
 * OutgoingPaymentTransport — 토큰 전송 driven port
 *
 * 호출자는 "이 토큰을 이 수신자에게 보내라"만 지시.
 * 페이로드 포맷(NUT-18), 릴레이 탐색, 암호화 등은 어댑터 내부에서 결정.
 */

export interface OutgoingPaymentTransport {
  send(params: OutgoingPaymentParams): Promise<OutgoingPaymentResult>
}

export interface OutgoingPaymentParams {
  recipientPubkey: string
  token: string
  memo?: string
  requestId?: string
}

export interface OutgoingPaymentResult {
  success: boolean
  error?: string
}
