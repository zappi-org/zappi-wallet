/**
 * Composition root for InputRouter
 */

import { InputRouter } from '@/core/services/input-router.service'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'

export function createInputRouter(
  lnurl: Pick<LnurlGateway, 'fetchLnurl'>,
): InputRouter {
  return new InputRouter(lnurl)
}
