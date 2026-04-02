/**
 * payment-payload — NUT-18 PaymentRequestPayload 타입 + 조립 순수 함수
 *
 * I/O 없음, 외부 의존 없음.
 * Proof는 cashu-ts 의존을 피하기 위해 generic으로 처리.
 */

// ─── Types ───

export interface CashuProof {
  id: string
  amount: number
  secret: string
  C: string
  dleq?: {
    e: string
    s: string
    r: string
  }
}

export interface PaymentRequestPayload {
  id?: string
  memo?: string
  mint: string
  unit: string
  proofs: CashuProof[]
}

// ─── Build ───

export function buildPaymentPayload(params: {
  mint: string
  unit: string
  proofs: CashuProof[]
  id?: string
  memo?: string
}): PaymentRequestPayload {
  const payload: PaymentRequestPayload = {
    mint: params.mint,
    unit: params.unit,
    proofs: params.proofs,
  }

  if (params.id) payload.id = params.id
  if (params.memo) payload.memo = params.memo

  return payload
}

export function serializePaymentPayload(payload: PaymentRequestPayload): string {
  return JSON.stringify(payload)
}
