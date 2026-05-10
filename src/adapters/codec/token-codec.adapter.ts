import type { CashuRequestTransport, ParsedCashuRequest } from '@/core/domain/input-types'
import type { CashuTokenInspection, DecodedInvoice, TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { Unit } from '@/core/domain/amount'
import { amount as createAmount } from '@/core/domain/amount'
import {
  PaymentRequest as CashuPaymentRequest,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts'
import { decode as cborDecode } from 'cbor-x'
import { decode as decodeBolt11Raw } from 'light-bolt11-decoder'

export class TokenCodecAdapter implements TokenCodec {
  // ─── Bolt11 ───

  isBolt11(input: string): boolean {
    const lower = input.toLowerCase().replace(/^lightning:/, '')
    return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt')
  }

  decodeBolt11(invoice: string): DecodedInvoice {
    const clean = invoice.replace(/^lightning:/i, '')
    const decoded = decodeBolt11Raw(clean)
    const sections = decoded.sections

    let amountSats = 0
    let description: string | undefined
    let expiry = 3600
    let paymentHash: string | undefined
    let timestamp = 0

    for (const section of sections) {
      if (section.name === 'amount') {
        amountSats = Math.floor(Number(section.value) / 1000)
      } else if (section.name === 'description') {
        description = section.value as string
      } else if (section.name === 'expiry') {
        expiry = Number(section.value)
      } else if (section.name === 'payment_hash') {
        paymentHash = section.value as string
      } else if (section.name === 'timestamp') {
        timestamp = Number(section.value)
      }
    }

    const expiryTimestamp = timestamp + expiry
    const isExpired = Date.now() / 1000 > expiryTimestamp

    return {
      amountSats,
      description,
      expiry: expiryTimestamp,
      paymentHash,
      isExpired,
    }
  }

  // ─── Lightning Address ───

  isLightningAddress(input: string): boolean {
    const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    return pattern.test(input) && input.includes('.')
  }

  // ─── Cashu Token ───

  isCashuToken(input: string): boolean {
    const trimmed = input.trim()
    return trimmed.startsWith('cashuA') || trimmed.startsWith('cashuB')
  }

  /**
   * 토큰 인코딩을 파싱하여 수신 전 정보를 추출.
   * mint keysets 검증 안 함 — receive 전 사전 확인용.
   */
  inspectCashuToken(token: string): CashuTokenInspection {
    try {
      const base64 = token.slice(6).replace(/-/g, '+').replace(/_/g, '/')
      const binary = atob(base64)
      const raw = Uint8Array.from(binary, c => c.charCodeAt(0))
      const data = cborDecode(raw)
      
      const amountValue = data.t?.reduce(
        (s: number, entry: any) =>
          s + entry.p.reduce((a: number, p: any) => a + p.a, 0),
        0
      ) ?? 0
      
      const unit: Unit = (data.u === 'msat' || data.u === 'usd' || data.u === 'eur') ? data.u : 'sat'
      
      return {
        mint: data.m,
        amount: createAmount(amountValue, unit),
        memo: data.d,
      }
    } catch (error) {
      console.error('[TokenCodec] Failed to parse Cashu token:', error)
      throw new Error('Invalid Cashu token format')
    }
  }
  // ─── Bitcoin URI (BIP-21) ───

  parseBitcoinUri(uri: string): {
    address?: string
    amount?: number
    lightning?: string
    cashuRequest?: string
  } | null {
    const trimmed = uri.trim()
    if (!trimmed.toLowerCase().startsWith('bitcoin:')) return null

    try {
      const url = new URL(trimmed)
      const address = url.pathname
      const lightning = url.searchParams.get('lightning') || undefined
      // NUT-26 standard key is `creq`; legacy `cr` accepted for backward compatibility.
      const cashuRequest =
        url.searchParams.get('creq') || url.searchParams.get('cr') || undefined
      const amountStr = url.searchParams.get('amount')
      const amount = amountStr ? Math.round(parseFloat(amountStr) * 1e8) : undefined

      return { address: address || undefined, amount, lightning, cashuRequest }
    } catch {
      return null
    }
  }

  // ─── NUT-18 Payment Request ───

  decodePaymentRequest(input: string): ParsedCashuRequest {
    const cashuReq = CashuPaymentRequest.fromEncodedRequest(input)

    const transports: CashuRequestTransport[] = (cashuReq.transport ?? []).map((t) => ({
      type: t.type === PaymentRequestTransportType.NOSTR ? 'nostr' : t.type === PaymentRequestTransportType.POST ? 'post' : String(t.type),
      target: t.target,
    }))

    const nostrTransport = transports.find((t) => t.type === 'nostr')
    const postTransport = transports.find((t) => t.type === 'post')

    let p2pkPubkey: string | undefined
    const nut10 = cashuReq.nut10
      ? { kind: cashuReq.nut10.kind, data: cashuReq.nut10.data, tags: cashuReq.nut10.tags }
      : undefined
    if (nut10?.kind === 'P2PK') {
      p2pkPubkey = nut10.data
    }

    return {
      id: cashuReq.id ?? '',
      amount: cashuReq.amount,
      unit: cashuReq.unit ?? 'sat',
      mints: cashuReq.mints ?? [],
      singleUse: cashuReq.singleUse,
      description: cashuReq.description,
      transports,
      nut10,
      hasNostrTransport: !!nostrTransport,
      nostrTarget: nostrTransport?.target,
      hasPostTransport: !!postTransport,
      postTarget: postTransport?.target,
      p2pkPubkey,
    }
  }

  encodePaymentRequest(
    opts: {
      amount: number
      unit: string
      mints: string[]
      transports: CashuRequestTransport[]
      id?: string
      p2pkPubkey?: string
      description?: string
      singleUse?: boolean
    },
    _format?: 'base64' | 'binary',
  ): string {
    const req = new CashuPaymentRequest(
      opts.transports.map((t) => ({
        type: t.type === 'nostr' ? PaymentRequestTransportType.NOSTR : PaymentRequestTransportType.POST,
        target: t.target,
      })),
      opts.id,
      opts.amount,
      opts.unit,
      opts.mints,
      opts.description,
      opts.singleUse,
    )
    return req.toEncodedCreqB()
  }

  createNostrPaymentRequest(opts: {
    amount: number
    unit: string
    mints: string[]
    p2pkPubkey?: string
    pubkey?: string
    relays?: string[]
    description?: string
  }): { request: string; id: string } {
    const id = generateRequestId('wallet')
    const transports: CashuRequestTransport[] = []

    if (opts.pubkey) {
      transports.push({ type: 'nostr', target: opts.pubkey })
    }

    const request = this.encodePaymentRequest({
      amount: opts.amount,
      unit: opts.unit ?? 'sat',
      mints: opts.mints,
      transports,
      id,
      p2pkPubkey: opts.p2pkPubkey,
      description: opts.description,
      singleUse: true,
    })

    return { request, id }
  }

  createDualTransportPaymentRequest(opts: {
    amount: number
    unit: string
    mints: string[]
    mintUrl: string
    p2pkPubkey?: string
    pubkey?: string
    relays?: string[]
    description?: string
  }): { request: string; id: string; httpEndpoint: string } {
    const id = generateRequestId('wallet')
    const httpEndpoint = `${opts.mintUrl.replace(/\/+$/, '')}/v1/payments/${id}`
    const transports: CashuRequestTransport[] = [
      { type: 'post', target: httpEndpoint },
    ]

    if (opts.pubkey) {
      transports.push({ type: 'nostr', target: opts.pubkey })
    }

    const request = this.encodePaymentRequest({
      amount: opts.amount,
      unit: opts.unit ?? 'sat',
      mints: opts.mints,
      transports,
      id,
      p2pkPubkey: opts.p2pkPubkey,
      description: opts.description,
      singleUse: true,
    })

    return { request, id, httpEndpoint }
  }

  buildUnifiedBitcoinUri(opts: { lightningInvoice: string; cashuRequest: string }): string {
    const params = new URLSearchParams()
    if (opts.lightningInvoice) params.set('lightning', opts.lightningInvoice)
    if (opts.cashuRequest) params.set('creq', opts.cashuRequest)
    return `bitcoin:?${params.toString()}`
  }
}

function generateRequestId(prefix: string): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}-${hex}`
}
