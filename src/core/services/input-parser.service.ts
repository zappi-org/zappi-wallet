import type { InputParserUseCase, DecodedCashuToken } from '@/core/ports/driving/input-parser.usecase'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type {
  InputType,
  ValidatedData,
  ParsedCashuRequest,
} from '@/core/domain/input-types'

export class InputParserService implements InputParserUseCase {
  constructor(
    private readonly codec: TokenCodec,
    private readonly lnurl: LnurlGateway,
  ) {}

  detectAndClassify(raw: string): InputType {
    const trimmed = raw.trim().replace(/^lightning:/i, '')

    // Bitcoin URI with possible cashu/lightning params
    const uriResult = this.codec.parseBitcoinUri(trimmed)
    if (uriResult) {
      if (uriResult.cashuRequest) {
        return {
          type: 'cashu-request',
          request: uriResult.cashuRequest,
          lightningInvoice: uriResult.lightning,
        }
      }
      if (uriResult.lightning) {
        try {
          const decoded = this.codec.decodeBolt11(uriResult.lightning)
          return {
            type: 'bolt11',
            invoice: uriResult.lightning,
            amountSats: decoded.amountSats,
            description: decoded.description,
            isExpired: decoded.isExpired,
            expiry: decoded.expiry,
            paymentHash: decoded.paymentHash,
          }
        } catch {
          // Fall through
        }
      }
    }

    // Bolt11
    if (this.codec.isBolt11(trimmed)) {
      try {
        const decoded = this.codec.decodeBolt11(trimmed)
        return {
          type: 'bolt11',
          invoice: trimmed,
          amountSats: decoded.amountSats,
          description: decoded.description,
          isExpired: decoded.isExpired,
          expiry: decoded.expiry,
          paymentHash: decoded.paymentHash,
        }
      } catch {
        return { type: 'unknown', input: trimmed }
      }
    }

    // Cashu token
    if (this.codec.isCashuToken(trimmed)) {
      try {
        const decoded = this.codec.decodeCashuToken(trimmed)
        return {
          type: 'cashu-token',
          token: trimmed,
          amountSats: decoded.amount,
          mintUrl: decoded.mint,
          memo: decoded.memo,
        }
      } catch {
        return { type: 'unknown', input: trimmed }
      }
    }

    // Lightning address
    if (this.codec.isLightningAddress(trimmed)) {
      return { type: 'lightning-address', address: trimmed }
    }

    // LNURL
    if (trimmed.toLowerCase().startsWith('lnurl')) {
      return { type: 'lnurl', lnurl: trimmed }
    }

    // Amount (pure number)
    const num = Number(trimmed)
    if (!isNaN(num) && num > 0 && Number.isInteger(num)) {
      return { type: 'amount', amount: num }
    }

    return { type: 'unknown', input: trimmed }
  }

  async validateAsync(input: InputType): Promise<ValidatedData> {
    switch (input.type) {
      case 'bolt11':
        return {
          type: 'bolt11',
          invoice: input.invoice,
          amountSats: input.amountSats,
          description: input.description,
          expiry: input.expiry,
          paymentHash: input.paymentHash,
        }

      case 'lightning-address': {
        const params = await this.lnurl.resolvePay(input.address)
        return {
          type: 'lightning-address',
          address: input.address,
          lnurlParams: params,
        }
      }

      case 'lnurl': {
        const response = await this.lnurl.fetchLnurl(input.lnurl)
        if (response.tag === 'payRequest') {
          return {
            type: 'lnurl-pay',
            lnurl: input.lnurl,
            params: response,
          }
        }
        if (response.tag === 'withdrawRequest') {
          return {
            type: 'lnurl-withdraw',
            lnurl: input.lnurl,
            params: response,
          }
        }
        throw new Error(`Unsupported LNURL tag: ${(response as { tag: string }).tag}`)
      }

      case 'cashu-token':
        return {
          type: 'cashu-token',
          token: input.token,
          amountSats: input.amountSats,
          mintUrl: input.mintUrl,
          memo: input.memo,
        }

      case 'cashu-request': {
        const parsed = this.decodeCashuRequest(input.request, input.lightningInvoice)
        return {
          type: 'cashu-request',
          request: input.request,
          parsed,
        }
      }

      case 'amount':
        return { type: 'amount', amount: input.amount }

      default:
        throw new Error(`Cannot validate input type: ${(input as { type: string }).type}`)
    }
  }

  decodeCashuToken(token: string): DecodedCashuToken {
    return this.codec.decodeCashuToken(token)
  }

  isBolt11(input: string): boolean {
    return this.codec.isBolt11(input)
  }

  isLightningAddress(input: string): boolean {
    return this.codec.isLightningAddress(input)
  }

  parseBitcoinUri(uri: string): { address?: string; amount?: number; lightning?: string; cashuRequest?: string } | null {
    return this.codec.parseBitcoinUri(uri)
  }

  decodeCashuRequest(input: string, lightningInvoice?: string): ParsedCashuRequest {
    const parsed = this.codec.decodePaymentRequest(input)
    if (lightningInvoice) {
      return { ...parsed, lightningInvoice }
    }
    return parsed
  }
}
