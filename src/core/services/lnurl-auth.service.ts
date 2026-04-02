import type { LnurlGateway, LnurlAuthParams } from '@/core/ports/driven/lnurl-gateway.port'
import type { KeyDeriver } from '@/core/ports/driven/key-deriver.port'

export interface AuthRequest {
  params: LnurlAuthParams
  domain: string
  action?: string
}

export interface AuthResult {
  success: boolean
  domain: string
  reason?: string
}

export class LnurlAuthService {
  constructor(
    private readonly lnurl: Required<Pick<LnurlGateway, 'parseAuth' | 'authenticate'>>,
    private readonly keyDeriver: KeyDeriver,
  ) {}

  async parseAuthUrl(url: string): Promise<AuthRequest> {
    const params = await this.lnurl.parseAuth(url)

    return {
      params,
      domain: params.domain,
      action: params.action,
    }
  }

  async confirmAuth(params: LnurlAuthParams): Promise<AuthResult> {
    const k1Bytes = hexToBytes(params.k1)

    const { publicKey } = await this.keyDeriver.deriveKey('lnurl-auth', params.domain)
    const signature = await this.keyDeriver.sign(k1Bytes, 'lnurl-auth', params.domain)

    const sigHex = bytesToHex(signature)
    const result = await this.lnurl.authenticate(params, sigHex, publicKey)

    return {
      success: result.status === 'OK',
      domain: params.domain,
      reason: result.reason,
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
