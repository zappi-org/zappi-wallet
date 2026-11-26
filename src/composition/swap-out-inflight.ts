import { useAppStore } from '@/store'

let sequence = 0
const applied = new Map<string, number>()

export function beginSwapOutInFlightWrite(): number {
  sequence += 1
  return sequence
}

export function writeSwapOutInFlight(
  token: number,
  amounts: Record<string, number>,
): void {
  for (const [mintUrl, amount] of Object.entries(amounts)) {
    if ((applied.get(mintUrl) ?? 0) > token) continue
    applied.set(mintUrl, token)
    useAppStore.getState().setSwapOutInFlight(mintUrl, amount)
  }
}
