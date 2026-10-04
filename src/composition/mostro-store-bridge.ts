import { useAppStore } from '@/store'
import type { MostroUseCase } from '@/core/ports/driving/mostro.usecase'

/**
 * Mostro snapshot → Zustand store bridge.
 *
 * The marketplace has no EventBus path (the SDK pushes via a subscribe callback),
 * so this is the single writer of the `mostro` slice. Returns an unsubscribe.
 */
export function connectMostroStoreBridge(mostro: MostroUseCase): () => void {
  return mostro.subscribe({
    onSnapshot: (snapshot) => useAppStore.getState().setMostroSnapshot(snapshot),
  })
}
