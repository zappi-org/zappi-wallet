/**
 * InputRouter — QR/입력 문자열 → 타입 분류기
 *
 * 순수 분류만 담당. 하위 서비스 호출 없음.
 * UI 레이어가 ParsedInput을 받아 적절한 서비스/화면으로 분기.
 */

import type { ContactAddressType } from '@/core/domain/contact'
import type {
  LnurlGateway,
  LnurlPayParams,
  LnurlWithdrawParams,
  LnurlAuthParams,
} from '@/core/ports/driven/lnurl-gateway.port'
import { lnurlDecode } from '@/core/domain/nostr-address'

// ─── ParsedInput ───

export type ParsedInput =
  | { type: 'address'; value: string; addressType: ContactAddressType }
  | { type: 'lnurl-pay'; params: LnurlPayParams }
  | { type: 'lnurl-withdraw'; params: LnurlWithdrawParams }
  | { type: 'lnurl-auth'; params: LnurlAuthParams }
  | { type: 'invoice'; bolt11: string }
  | { type: 'cashu-token'; token: string }

// ─── Service ───

export class InputRouter {
  constructor(
    private readonly lnurl: Pick<LnurlGateway, 'fetchLnurl'>,
  ) {}

  async classify(raw: string): Promise<ParsedInput> {
    const input = raw.trim()

    // lightning: URI prefix 제거
    const stripped = input.replace(/^lightning:/i, '')

    // BOLT11 invoice
    if (/^ln(bc|tb|tbs)1/i.test(stripped)) {
      return { type: 'invoice', bolt11: stripped.toLowerCase() }
    }

    // Cashu token
    if (/^cashu[AB]/i.test(stripped)) {
      return { type: 'cashu-token', token: stripped }
    }

    // LNURL-encoded string → HTTP 판별 필요
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

    throw new Error(`Unrecognized input: ${input}`)
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
