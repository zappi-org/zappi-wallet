/**
 * Composition root for InputRouter
 */

import { InputRouter } from '@/core/services/input-router.service'
import type { InputRouterUseCase } from '@/core/ports/driving/input-router.usecase'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'

export function createInputRouter(
  lnurl: Pick<LnurlGateway, 'fetchLnurl'>,
): InputRouterUseCase {
  return new InputRouter(lnurl)
}
