/**
 * InputRouter — classifies a QR/input string into a type.
 *
 * Pure classification only; calls no downstream services. The UI layer takes the
 * ParsedInput and branches to the appropriate service/screen.
 */

import { UnrecognizedInputError } from '@/core/errors/payment.errors'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { InputRouterUseCase, ParsedInput } from '@/core/ports/driving/input-router.usecase'
import { lnurlDecode } from '@/core/domain/nostr-address'

// Re-export for backward compatibility
export type { ParsedInput }

// ─── Service ───

export class InputRouter implements InputRouterUseCase {
  constructor(
    private readonly lnurl: Pick<LnurlGateway, 'fetchLnurl'>,
  ) {}

  async classify(raw: string): Promise<ParsedInput> {
    const input = raw.trim()

    // strip the lightning: URI prefix
    const stripped = input.replace(/^lightning:/i, '')

    // BOLT11 invoice
    if (/^ln(bc|tb|tbs)1/i.test(stripped)) {
      return { type: 'invoice', bolt11: stripped.toLowerCase() }
    }

    // Cashu token
    if (/^cashu[AB]/i.test(stripped)) {
      return { type: 'cashu-token', token: stripped }
    }

    // LNURL-encoded string → needs an HTTP probe to disambiguate
    if (/^lnurl1/i.test(stripped)) {
      return this.classifyLnurl(stripped)
    }

    // nostr npub
    if (stripped.startsWith('npub1')) {
      return { type: 'address', value: stripped, addressType: 'npub' }
    }

    // nostr nprofile
    if (stripped.startsWith('nprofile1')) {
      return { type: 'address', value: stripped, addressType: 'nprofile' }
    }

    // BOLT12 offer
    if (stripped.startsWith('lno1')) {
      return { type: 'address', value: stripped, addressType: 'bolt12' }
    }

    // Lightning Address (email-like)
    if (stripped.includes('@') && stripped.includes('.')) {
      return { type: 'address', value: stripped, addressType: 'email' }
    }

    throw new UnrecognizedInputError(`Unrecognized input: ${input}`)
  }

  private async classifyLnurl(lnurl: string): Promise<ParsedInput> {
    const url = lnurlDecode(lnurl)
    const response = await this.lnurl.fetchLnurl(url)

    switch (response.tag) {
      case 'payRequest':
        return { type: 'lnurl-pay', params: response }
      case 'withdrawRequest':
        return { type: 'lnurl-withdraw', params: response }
      case 'login':
        return { type: 'lnurl-auth', params: response }
    }
  }
}
