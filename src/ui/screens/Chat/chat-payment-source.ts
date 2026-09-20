import type { ValidatedBolt11, ValidatedCashuRequest } from '@/core/domain/input-types'
import { mintUrlKey } from '@/core/domain/mint-url'
import { findCommonMints, PaymentRoute, selectSourceMint } from '@/core/domain/routing'

export function selectChatPaymentMint(
  validated: ValidatedCashuRequest | ValidatedBolt11,
  configuredMints: string[],
  balances: Record<string, number>,
  preferred?: string | null,
): string | null {
  const request = validated.type === 'cashu-request' ? validated.parsed : undefined
  const allowed = request?.sameMintOnly && request.mints.length > 0
    ? findCommonMints(configuredMints, request.mints)
    : configuredMints
  const allowedKeys = new Set(allowed.map(mintUrlKey))
  const funded = Object.fromEntries(Object.entries(balances).filter(
    ([mint, balance]) => allowedKeys.has(mintUrlKey(mint)) && Number.isFinite(balance) && balance > 0,
  ))
  const amount = request?.amount ?? (validated.type === 'bolt11' ? validated.amountSats : undefined) ?? 0
  const sufficient = Object.fromEntries(Object.entries(funded).filter(([, balance]) => balance >= amount))
  const common = request ? findCommonMints(Object.keys(sufficient), request.mints) : []
  if (common.length) return selectSourceMint(PaymentRoute.TOKEN_TRANSFER, sufficient, amount, common)

  const preferredKey = preferred ? mintUrlKey(preferred) : undefined
  const preferredFunded = Object.keys(sufficient).find((mint) => mintUrlKey(mint) === preferredKey)
  if (preferredFunded) return preferredFunded

  return selectSourceMint(PaymentRoute.OWN_MINT_TOKEN, funded, amount)
    ?? allowed.find((mint) => mintUrlKey(mint) === preferredKey)
    ?? allowed[0]
    ?? null
}
