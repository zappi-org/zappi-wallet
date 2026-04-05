/**
 * InputRouterUseCase — QR/입력 문자열 분류 driving port
 */

import type { ContactAddressType } from '@/core/domain/contact'
import type {
  LnurlPayParams,
  LnurlWithdrawParams,
  LnurlAuthParams,
} from '@/core/ports/driven/lnurl-gateway.port'

export type ParsedInput =
  | { type: 'address'; value: string; addressType: ContactAddressType }
  | { type: 'lnurl-pay'; params: LnurlPayParams }
  | { type: 'lnurl-withdraw'; params: LnurlWithdrawParams }
  | { type: 'lnurl-auth'; params: LnurlAuthParams }
  | { type: 'invoice'; bolt11: string }
  | { type: 'cashu-token'; token: string }

export interface InputRouterUseCase {
  classify(raw: string): Promise<ParsedInput>
}
