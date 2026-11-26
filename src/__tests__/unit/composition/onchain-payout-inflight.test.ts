import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  beginOnchainPayoutInFlightWrite,
  writeOnchainPayoutInFlight,
} from '@/composition/onchain-payout-inflight'
import { useAppStore } from '@/store'

function inFlight(): Record<string, number> {
  return useAppStore.getState().onchainPayoutInFlightByMint
}

describe('onchain payout in-flight writes', () => {
  beforeEach(() => {
    useAppStore.getState().resetOnchainPayouts()
  })

  afterEach(() => {
    useAppStore.getState().resetOnchainPayouts()
  })

  it('ignores a write computed before the one already applied', () => {
    const older = beginOnchainPayoutInFlightWrite()
    const newer = beginOnchainPayoutInFlightWrite()

    writeOnchainPayoutInFlight(newer, { 'https://mint.example.com': 0 })
    writeOnchainPayoutInFlight(older, { 'https://mint.example.com': 50500 })

    expect(inFlight()).toEqual({ 'https://mint.example.com': 0 })
  })

  it('applies a newer write after an older one', () => {
    const older = beginOnchainPayoutInFlightWrite()
    const newer = beginOnchainPayoutInFlightWrite()

    writeOnchainPayoutInFlight(older, { 'https://mint.example.com': 50500 })
    writeOnchainPayoutInFlight(newer, { 'https://mint.example.com': 0 })

    expect(inFlight()).toEqual({ 'https://mint.example.com': 0 })
  })

  it('keeps the newest value per mint', () => {
    const first = beginOnchainPayoutInFlightWrite()
    const stale = beginOnchainPayoutInFlightWrite()
    const newest = beginOnchainPayoutInFlightWrite()

    writeOnchainPayoutInFlight(first, { 'https://a.example.com': 1000 })
    writeOnchainPayoutInFlight(newest, {
      'https://a.example.com': 2000,
      'https://b.example.com': 0,
    })
    writeOnchainPayoutInFlight(stale, { 'https://b.example.com': 3000 })

    expect(inFlight()).toEqual({
      'https://a.example.com': 2000,
      'https://b.example.com': 0,
    })
  })
})
