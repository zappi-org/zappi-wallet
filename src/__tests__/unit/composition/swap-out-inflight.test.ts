import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  beginSwapOutInFlightWrite,
  writeSwapOutInFlight,
} from '@/composition/swap-out-inflight'
import { useAppStore } from '@/store'

function inFlight(): Record<string, number> {
  return useAppStore.getState().swapOutInFlightByMint
}

describe('swap-out in-flight writes', () => {
  beforeEach(() => {
    useAppStore.getState().resetSwapOuts()
  })

  afterEach(() => {
    useAppStore.getState().resetSwapOuts()
  })

  it('ignores a write computed before the one already applied', () => {
    const older = beginSwapOutInFlightWrite()
    const newer = beginSwapOutInFlightWrite()

    writeSwapOutInFlight(newer, { 'https://mint.example.com': 0 })
    writeSwapOutInFlight(older, { 'https://mint.example.com': 50500 })

    expect(inFlight()).toEqual({ 'https://mint.example.com': 0 })
  })

  it('applies a newer write after an older one', () => {
    const older = beginSwapOutInFlightWrite()
    const newer = beginSwapOutInFlightWrite()

    writeSwapOutInFlight(older, { 'https://mint.example.com': 50500 })
    writeSwapOutInFlight(newer, { 'https://mint.example.com': 0 })

    expect(inFlight()).toEqual({ 'https://mint.example.com': 0 })
  })

  it('keeps the newest value per mint', () => {
    const first = beginSwapOutInFlightWrite()
    const stale = beginSwapOutInFlightWrite()
    const newest = beginSwapOutInFlightWrite()

    writeSwapOutInFlight(first, { 'https://a.example.com': 1000 })
    writeSwapOutInFlight(newest, {
      'https://a.example.com': 2000,
      'https://b.example.com': 0,
    })
    writeSwapOutInFlight(stale, { 'https://b.example.com': 3000 })

    expect(inFlight()).toEqual({
      'https://a.example.com': 2000,
      'https://b.example.com': 0,
    })
  })
})
