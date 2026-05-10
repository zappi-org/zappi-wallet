import type {
  InputType,
  ValidatedData,
  ParsedCashuRequest,
} from '@/core/domain/input-types'
import type { CashuTokenInspection } from '@/core/ports/driven/token-codec.port'

export interface InputParserUseCase {
  /** Synchronous local detection: bolt11, cashu token, bitcoin URI, lightning address, lnurl, amount */
  detectAndClassify(raw: string): InputType

  /** Async network validation: resolves LNURL, validates lightning addresses, etc. */
  validateAsync(input: InputType): Promise<ValidatedData>

  /** Decode a Cashu token (wraps SDK) */
  inspectCashuToken(token: string): CashuTokenInspection

  /** Format-level checks (no network) */
  isBolt11(input: string): boolean
  isLightningAddress(input: string): boolean
  parseBitcoinUri(uri: string): { address?: string; amount?: number; lightning?: string; cashuRequest?: string } | null

  /** Decode a NUT-18 payment request */
  decodeCashuRequest(input: string, lightningInvoice?: string): ParsedCashuRequest
}
