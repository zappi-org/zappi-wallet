import type {
  ParsedCashuRequest,
  CashuRequestTransport,
} from '@/core/domain/input-types'

export interface DecodedInvoice {
  amountSats: number
  description?: string
  expiry: number
  paymentHash?: string
  isExpired: boolean
}

export interface DecodedCashuToken {
  amount: number
  mint: string
  memo?: string
}

export interface TokenCodec {
  // Bolt11
  isBolt11(input: string): boolean
  decodeBolt11(invoice: string): DecodedInvoice

  // Lightning address
  isLightningAddress(input: string): boolean

  // Cashu token
  decodeCashuToken(token: string): DecodedCashuToken
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
