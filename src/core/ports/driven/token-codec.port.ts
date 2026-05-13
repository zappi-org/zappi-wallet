import type {
  CashuRequestTransport,
  ParsedCashuRequest,
} from '@/core/domain/input-types'
import type { Amount } from '@/core/domain/amount'
import type { CashuProof } from '@/core/domain/cashu-payment-payload'

export interface DecodedInvoice {
  amountSats: number
  description?: string
  expiry: number
  paymentHash?: string
  isExpired: boolean
}

/**
 * 토큰 수신 전 정보 검사 결과 (파싱만, 검증 없음).
 * receive() 호출 전 mint 신뢰도, 금액, 단위 확인용.
 */
export interface CashuTokenInspection {
  mint: string
  amount: Amount
  memo?: string
}

export interface TokenCodec {
  // Bolt11
  isBolt11(input: string): boolean
  decodeBolt11(invoice: string): DecodedInvoice

  // Lightning address
  isLightningAddress(input: string): boolean

  // Cashu token
  /**
   * 토큰 인코딩을 파싱하여 수신 전 정보를 추출.
   * mint keysets 검증 안 함 — receive 전 사전 확인용.
   */
  inspectCashuToken(token: string): CashuTokenInspection
  encodeCashuToken(opts: {
    mint: string
    proofs: CashuProof[]
    unit?: string
    memo?: string
  }): string
  isCashuToken(input: string): boolean

  
  // Bitcoin URI (BIP-21)
  parseBitcoinUri(uri: string): {
    address?: string
    amount?: number
    lightning?: string
    cashuRequest?: string
  } | null

  // NUT-18 payment request
  decodePaymentRequest(input: string): ParsedCashuRequest
  encodePaymentRequest(
    opts: {
      amount: number
      unit: string
      mints: string[]
      transports: CashuRequestTransport[]
      p2pkPubkey?: string
      description?: string
      singleUse?: boolean
    },
    format?: 'base64' | 'binary',
  ): string
  createNostrPaymentRequest(opts: {
    amount: number
    unit: string
    mints: string[]
    p2pkPubkey?: string
    pubkey?: string
    relays?: string[]
    description?: string
  }): { request: string; id: string }
  createDualTransportPaymentRequest(opts: {
    amount: number
    unit: string
    mints: string[]
    mintUrl: string
    p2pkPubkey?: string
    pubkey?: string
    relays?: string[]
    description?: string
  }): { request: string; id: string; httpEndpoint: string }
  buildUnifiedBitcoinUri(opts: {
    lightningInvoice: string
    cashuRequest: string
  }): string
}
