/**
 * Route Selection — Pure Functions
 *
 * URI 정보 + sender mint 목록으로 최적 결제 경로를 결정한다.
 * Side effect 없음. 단위 테스트 100% 가능.
 *
 * Decision Table (ZAP-86 spec):
 * | creq | m | LN | common | fee-opt     | privacy     |
 * |------|---|----|--------|-------------|-------------|
 * | O    | O | O  | O      | #2 LN int   | #1 Token    |
 * | O    | O | X  | O      | #1 Token    | #1 Token    |
 * | O    | O | O  | X      | #3 LN cross | #4 Mint+DM  |
 * | O    | O | X  | X      | #4 Mint+DM  | #4 Mint+DM  |
 * | O    | X | O  | -      | #5 Melt>LN  | #6 Own tkn  |
 * | O    | X | X  | -      | #6 Own tkn  | #6 Own tkn  |
 * | X    | - | O  | -      | #5 Melt>LN  | #5 Melt>LN  |
 * | X    | - | X  | -      | CANNOT SEND | CANNOT SEND |
 */

import { PaymentRoute, type RouteInput } from './types'

/**
 * URI + sender context → 최적 결제 라우트 선택
 */
export function selectRoute(input: RouteInput): PaymentRoute {
  const { validatedData, senderMints, privacyMode, lightningInvoice } = input
  const senderMintUrls = Object.keys(senderMints).filter((m) => senderMints[m] > 0)

  // ─── Non-creq paths ───
  if (validatedData.type === 'bolt11' || validatedData.type === 'lightning-address' || validatedData.type === 'lnurl-pay') {
    return PaymentRoute.MELT_TO_LN
  }

  if (validatedData.type === 'my-wallet') {
    return PaymentRoute.LN_CROSS_MINT
  }

  // ─── creq path ───
  if (validatedData.type !== 'cashu-request') {
    return PaymentRoute.CANNOT_SEND
  }

  const { parsed } = validatedData
  const hasMints = parsed.mints.length > 0
  const hasLn = !!lightningInvoice || !!parsed.lightningInvoice

  if (hasMints) {
    const commonMints = findCommonMints(senderMintUrls, parsed.mints)

    if (commonMints.length > 0) {
      // creq + m + common mints
      if (privacyMode) return PaymentRoute.TOKEN_TRANSFER
      if (hasLn) return PaymentRoute.LN_INTERNAL
      return PaymentRoute.TOKEN_TRANSFER
    } else {
      // creq + m + no common mints
      if (privacyMode) return PaymentRoute.MINT_AND_DM
      if (hasLn) return PaymentRoute.LN_CROSS_MINT
      return PaymentRoute.MINT_AND_DM
    }
  } else {
    // creq + no m field
    if (privacyMode) return PaymentRoute.OWN_MINT_TOKEN
    if (hasLn) return PaymentRoute.MELT_TO_LN
    return PaymentRoute.OWN_MINT_TOKEN
  }
}

/**
 * 라우트에 따라 최적 source mint 선택.
 * Best-fit: smallest balance >= amount (기존 sendLightning 알고리즘)
 */
export function selectSourceMint(
  route: PaymentRoute,
  senderMints: Record<string, number>,
  amount: number,
  commonMints?: string[],
): string | null {
  // Token routes on common mint: prefer common mints
  if (
    (route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.LN_INTERNAL) &&
    commonMints &&
    commonMints.length > 0
  ) {
    return bestFitMint(senderMints, amount, commonMints)
  }

  // All other routes: any mint with sufficient balance
  return bestFitMint(senderMints, amount)
}

/**
 * sender mints ∩ receiver mints
 */
export function findCommonMints(senderMints: string[], receiverMints: string[]): string[] {
  const receiverSet = new Set(receiverMints.map(normalizeUrl))
  return senderMints.filter((m) => receiverSet.has(normalizeUrl(m)))
}

// ─── Internal helpers ───

/**
 * Best-fit mint selection: smallest balance >= amount.
 * Optionally restricted to a candidate set.
 */
function bestFitMint(
  mints: Record<string, number>,
  amount: number,
  candidates?: string[],
): string | null {
  const pool = candidates
    ? candidates.filter((m) => m in mints)
    : Object.keys(mints)

  const sufficient = pool
    .filter((m) => mints[m] >= amount)
    .sort((a, b) => mints[a] - mints[b])

  if (sufficient.length > 0) return sufficient[0]

  // Fallback: largest balance (will likely fail, but gives best error)
  const fallback = [...pool].sort((a, b) => mints[b] - mints[a])
  return fallback[0] || null
}

/** Normalize mint URL for comparison (strip trailing slash) */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}
