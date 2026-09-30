import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import { connectMostroStoreBridge } from '@/composition/mostro-store-bridge'
import type { MostroUseCase } from '@/core/ports/driving/mostro.usecase'
import type { MostroSnapshot } from '@/core/domain/mostro'

const SNAPSHOT: MostroSnapshot = {
  status: 'ready',
  availability: { available: true },
  orders: [],
  trades: {},
}

describe('mostro slice', () => {
  beforeEach(() => useAppStore.getState().resetMostro())

  it('starts unavailable and resets to it', () => {
    expect(useAppStore.getState().mostro.availability.available).toBe(false)
    useAppStore.getState().setMostroSnapshot(SNAPSHOT)
    expect(useAppStore.getState().mostro).toEqual(SNAPSHOT)
    useAppStore.getState().resetMostro()
    expect(useAppStore.getState().mostro.availability.available).toBe(false)
    expect(useAppStore.getState().mostro.orders).toEqual([])
  })
})

describe('connectMostroStoreBridge', () => {
  beforeEach(() => useAppStore.getState().resetMostro())

  it('mirrors the adapter snapshot into the store and unsubscribes', () => {
    const unsubscribe = vi.fn()
    const mostro = {
      subscribe: (listener: { onSnapshot?: (s: MostroSnapshot) => void }) => {
        listener.onSnapshot?.(SNAPSHOT)
        return unsubscribe
      },
    } as unknown as MostroUseCase

    const stop = connectMostroStoreBridge(mostro)
    expect(useAppStore.getState().mostro).toEqual(SNAPSHOT)

    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
