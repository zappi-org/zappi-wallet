import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { KeyDeriver } from '@/core/ports/driven/key-deriver.port'
import { Ok, Err } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'
import type {
  LnurlAuthUseCase,
  AuthRequest,
  AuthResult,
} from '@/core/ports/driving/lnurl-auth.usecase'

export class LnurlAuthService implements LnurlAuthUseCase {
  constructor(
    private readonly lnurl: Required<Pick<LnurlGateway, 'parseAuth' | 'authenticate'>>,
    private readonly keyDeriver: KeyDeriver,
  ) {}

  async parseAuthUrl(url: string): Promise<Result<AuthRequest, PaymentError>> {
    try {
      const params = await this.lnurl.parseAuth(url)
      return Ok({
        domain: params.domain,
        action: params.action,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse auth URL'
      return Err({ code: 'LNURL_PARSE_FAILED', message })
    }
  }

  async confirmAuth(url: string): Promise<Result<AuthResult, PaymentError>> {
    try {
      const params = await this.lnurl.parseAuth(url)
      const k1Bytes = hexToBytes(params.k1)

      const { publicKey } = await this.keyDeriver.deriveKey('lnurl-auth', params.domain)
      const signature = await this.keyDeriver.sign(k1Bytes, 'lnurl-auth', params.domain)

      const sigHex = bytesToHex(signature)
      const result = await this.lnurl.authenticate(params, sigHex, publicKey)

      if (result.status !== 'OK') {
        return Err({ code: 'AUTH_FAILED', message: result.reason || 'Authentication rejected' })
      }

      return Ok({
        success: true,
        domain: params.domain,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed'
      return Err({ code: 'AUTH_FAILED', message })
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
