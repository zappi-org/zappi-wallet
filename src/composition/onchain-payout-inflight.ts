import { useAppStore } from '@/store'

let sequence = 0
const applied = new Map<string, number>()

export function beginOnchainPayoutInFlightWrite(): number {
  sequence += 1
  return sequence
}

export function writeOnchainPayoutInFlight(
  token: number,
  amounts: Record<string, number>,
): void {
  for (const [mintUrl, amount] of Object.entries(amounts)) {
    if ((applied.get(mintUrl) ?? 0) > token) continue
    applied.set(mintUrl, token)
    useAppStore.getState().setOnchainPayoutInFlight(mintUrl, amount)
  }
}
