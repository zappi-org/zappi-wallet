/**
 * Send-route resolution — pure decision logic for direct-token sends.
 *
 * Given the result of resolving a direct payment recipient and any fallback
 * lightning params, decides whether to:
 * - advance with ecash (ready)
 * - ask for mint selection (needs-mint-selection)
 * - fall back to LNURL pay (lnurl-fallback)
 * - fail with a domain error code (error)
 */

import type { ValidatedCashuRequest, ValidatedEmailAddress } from './input-types'

export type DirectPaymentResolution =
  | {
      status: 'ready'
      validatedData: ValidatedCashuRequest
      commonMintUrls: string[]
      selectedMintUrl: string
    }
  | {
      status: 'needs-mint-selection'
      validatedData: ValidatedCashuRequest
      commonMintUrls: string[]
    }
  | { status: 'no-info' }
  | { status: 'no-common-mint' }
  | { status: 'no-relay' }

export type SendRouteError = 'no-common-mint' | 'no-relay' | 'no-info'

export type SendRouteDecision =
  | { kind: 'advance'; data: ValidatedCashuRequest; mintUrl?: string; commonMintUrls: string[] }
  | { kind: 'needs-mint-selection'; data: ValidatedCashuRequest; commonMintUrls: string[] }
  | { kind: 'lnurl-fallback'; data: ValidatedEmailAddress }
  | { kind: 'error'; error: SendRouteError }

export type SendCashuRouteDecision =
  | { kind: 'advance'; data: ValidatedCashuRequest; mintUrl?: string; commonMintUrls: string[] }
  | { kind: 'needs-mint-selection'; data: ValidatedCashuRequest; commonMintUrls: string[] }
  | { kind: 'error'; error: SendRouteError }

export const SEND_ROUTE_ERROR_I18N = {
  'no-common-mint': 'send.destination.noCommonMint',
  'no-relay': 'send.destination.relayNotFound',
  'no-info': 'send.destination.ecashInfoNotFound',
} as const satisfies Record<SendRouteError, string>

export function resolveSendRoute(
  emailValidated: ValidatedEmailAddress,
  resolution: DirectPaymentResolution,
): SendRouteDecision {
  if (resolution.status === 'ready') {
    return {
      kind: 'advance',
      data: resolution.validatedData,
      mintUrl: resolution.selectedMintUrl,
      commonMintUrls: resolution.commonMintUrls,
    }
  }

  if (resolution.status === 'needs-mint-selection') {
    return {
      kind: 'needs-mint-selection',
      data: resolution.validatedData,
      commonMintUrls: resolution.commonMintUrls,
    }
  }

  // Direct-token resolution failed. Fall back to LNURL if available.
  if (emailValidated.lnurlParams) {
    return { kind: 'lnurl-fallback', data: emailValidated }
  }

  const error: SendRouteError =
    resolution.status === 'no-common-mint'
      ? 'no-common-mint'
      : resolution.status === 'no-relay'
        ? 'no-relay'
        : 'no-info'

  return { kind: 'error', error }
}

/**
 * Wraps a direct-payment lookup so a rejection becomes a domain status.
 *
 * Resolving a recipient hits the network and can throw (unreachable relay,
 * malformed npub past the bare prefix check). A throw tells the user nothing
 * more than a lookup that found nothing, so it collapses to `no-info` and every
 * caller keeps speaking through SEND_ROUTE_ERROR_I18N instead of leaking an
 * unhandled rejection. Takes a thunk so a synchronous throw is caught too.
 */
export async function resolveDirectPaymentOrNoInfo(
  resolve: () => Promise<DirectPaymentResolution>,
): Promise<DirectPaymentResolution> {
  try {
    return await resolve()
  } catch {
    return { status: 'no-info' }
  }
}

export function resolveCashuRoute(
  resolution: DirectPaymentResolution,
): SendCashuRouteDecision {
  if (resolution.status === 'ready') {
    return {
      kind: 'advance',
      data: resolution.validatedData,
      mintUrl: resolution.selectedMintUrl,
      commonMintUrls: resolution.commonMintUrls,
    }
  }

  if (resolution.status === 'needs-mint-selection') {
    return {
      kind: 'needs-mint-selection',
      data: resolution.validatedData,
      commonMintUrls: resolution.commonMintUrls,
    }
  }

  const error: SendRouteError =
    resolution.status === 'no-common-mint'
      ? 'no-common-mint'
      : resolution.status === 'no-relay'
        ? 'no-relay'
        : 'no-info'

  return { kind: 'error', error }
}
