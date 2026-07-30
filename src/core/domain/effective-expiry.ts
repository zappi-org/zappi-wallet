import { isExpired } from './pending-operation'

// 'fulfilled' is resolved at the service layer from the request's own
// fulfillment status — the pure expiry check below only knows alive/expired.
export type EffectiveExpiryStatus = 'alive' | 'expired' | 'fulfilled'

export interface CounterpartyStateProbe {
  checkAlive(): Promise<boolean | undefined>
}

/**
 * Effective expiry = local expiry AND any counterparty liveness signal.
 * If every live-check-capable counterparty reports dead, the item is expired.
 * Probes that cannot determine state should return undefined and are ignored.
 */
export async function checkEffectiveExpiry(
  item: { expiresAt?: number },
  probes: CounterpartyStateProbe[],
  now: number = Date.now(),
): Promise<EffectiveExpiryStatus> {
  if (isExpired(item, now)) {
    return 'expired'
  }

  if (probes.length === 0) {
    return 'alive'
  }

  const results = await Promise.all(probes.map((probe) => probe.checkAlive()))
  const determined = results.filter((result): result is boolean => result !== undefined)

  if (determined.length === 0) {
    return 'alive'
  }

  return determined.some(Boolean) ? 'alive' : 'expired'
}
