import {
  PaymentRoute,
  ROUTE_LABELS,
  findCommonMints,
  selectRoute,
  type RouteSelection,
} from '@/core/domain/routing'

import type { SendableValidatedData } from './SendFlow'

interface PlanRouteSelectionParams {
  validated: SendableValidatedData
  amount: number
  sourceMintUrl: string
  balances: Record<string, number>
  privacyMode: boolean
}

function getSelectedMintBalances(
  balances: Record<string, number>,
  sourceMintUrl: string,
): Record<string, number> {
  return {
    [sourceMintUrl]: balances[sourceMintUrl] ?? 0,
  }
}

function getRouteInvoice(validated: SendableValidatedData): string | undefined {
  switch (validated.type) {
    case 'bolt11':
      return validated.invoice
    case 'cashu-request':
      return validated.parsed.lightningInvoice
    default:
      return undefined
  }
}

export function planRouteSelection({
  validated,
  amount,
  sourceMintUrl,
  balances,
  privacyMode,
}: PlanRouteSelectionParams): RouteSelection {
  const senderMints = getSelectedMintBalances(balances, sourceMintUrl)
  const route = selectRoute({
    validatedData: validated,
    senderMints,
    amount,
    privacyMode,
    lightningInvoice: validated.type === 'cashu-request' ? validated.parsed.lightningInvoice : undefined,
  })

  const receiverMints = validated.type === 'cashu-request' ? validated.parsed.mints : []
  const commonMints = receiverMints.length > 0
    ? findCommonMints(Object.keys(senderMints).filter((mint) => senderMints[mint] > 0), receiverMints)
    : []

  let targetMintUrl: string | undefined
  if (route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.LN_INTERNAL) {
    targetMintUrl = commonMints[0]
  } else if (route === PaymentRoute.LN_CROSS_MINT || route === PaymentRoute.MINT_AND_DM) {
    targetMintUrl = validated.type === 'cashu-request'
      ? validated.parsed.mints[0]
      : validated.type === 'my-wallet'
        ? validated.targetMintUrl
        : undefined
  }

  return {
    route,
    amount,
    sourceMintUrl,
    targetMintUrl,
    invoice: getRouteInvoice(validated),
    estimatedFee: 0,
    reason: ROUTE_LABELS[route],
  }
}
