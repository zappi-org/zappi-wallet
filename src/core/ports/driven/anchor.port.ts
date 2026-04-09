export interface AnchorData {
  timestamp: number
  eventId: string
  cachedAt: number
}

export interface AnchorStore {
  getCachedAnchor(): AnchorData | null
  setCachedAnchor(anchor: AnchorData): void
  clearCachedAnchor(): void
}
