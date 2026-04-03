import type { AnchorStore, AnchorData } from '@/core/ports/driven/anchor.port'

const ANCHOR_CACHE_KEY = 'zappi-anchor'

export class AnchorStoreAdapter implements AnchorStore {
  getCachedAnchor(): AnchorData | null {
    try {
      const cached = localStorage.getItem(ANCHOR_CACHE_KEY)
      if (!cached) return null
      return JSON.parse(cached) as AnchorData
    } catch {
      return null
    }
  }

  setCachedAnchor(anchor: AnchorData): void {
    localStorage.setItem(ANCHOR_CACHE_KEY, JSON.stringify(anchor))
  }

  clearCachedAnchor(): void {
    localStorage.removeItem(ANCHOR_CACHE_KEY)
  }
}
