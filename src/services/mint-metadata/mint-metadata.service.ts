import { MintMetadataRepository } from '@/data/repositories'
import type { MintMetadata } from '@/core/types'
import { TIMEOUTS } from '@/core/constants'
import { metadataEvents } from './metadata-events'

/**
 * NUT-06 mint info response
 */
interface MintInfoResponse {
  name?: string
  pubkey?: string
  version?: string
  description?: string
  description_long?: string
  contact?: Array<{ method: string; info: string }>
  motd?: string
  icon_url?: string
  urls?: string[]
  time?: number
  nuts?: Record<string, unknown>
}

/**
 * Refresh interval for mint metadata (24 hours)
 */
const METADATA_REFRESH_INTERVAL = 24 * 60 * 60 * 1000

/**
 * Service for fetching and caching mint metadata (NUT-06)
 * Supports offline-first operation with IndexedDB caching
 */
class MintMetadataService {
  private repository = new MintMetadataRepository()
  private inFlightRequests = new Map<string, Promise<MintMetadata | null>>()

  /**
   * Get metadata for a mint (from cache if available, fetch if needed)
   * Returns cached data immediately for offline support
   */
  async getMetadata(mintUrl: string): Promise<MintMetadata | null> {
    // Always try cache first for offline support
    const cached = await this.repository.get(mintUrl)

    // If cached and fresh, return it
    if (cached && !this.isStale(cached)) {
      return cached
    }

    // Try to refresh in background if stale but still return cached
    if (cached) {
      this.refreshInBackground(mintUrl)
      return cached
    }

    // No cache, need to fetch
    return this.fetchAndCache(mintUrl)
  }

  /**
   * Get metadata for multiple mints
   */
  async getMetadataForMints(mintUrls: string[]): Promise<Map<string, MintMetadata>> {
    const cachedMap = await this.repository.getMany(mintUrls)

    // Find mints that need fetching
    const needsFetch = mintUrls.filter((url) => !cachedMap.has(url))

    // Fetch missing metadata in parallel
    if (needsFetch.length > 0) {
      const fetchPromises = needsFetch.map((url) => this.fetchAndCache(url))
      const results = await Promise.allSettled(fetchPromises)

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          cachedMap.set(needsFetch[index], result.value)
        }
      })
    }

    // Refresh stale entries in background
    for (const [url, metadata] of cachedMap) {
      if (this.isStale(metadata)) {
        this.refreshInBackground(url)
      }
    }

    return cachedMap
  }

  /**
   * Fetch metadata from mint and cache it
   */
  async fetchAndCache(mintUrl: string): Promise<MintMetadata | null> {
    // Dedupe in-flight requests
    const existing = this.inFlightRequests.get(mintUrl)
    if (existing) return existing

    const promise = this.doFetch(mintUrl)
    this.inFlightRequests.set(mintUrl, promise)

    try {
      return await promise
    } finally {
      this.inFlightRequests.delete(mintUrl)
    }
  }

  /**
   * Force refresh metadata for a mint
   */
  async refresh(mintUrl: string): Promise<MintMetadata | null> {
    return this.fetchAndCache(mintUrl)
  }

  /**
   * Fetch metadata only if not cached (for mints that were offline during initial fetch)
   */
  async refreshIfMissing(mintUrl: string): Promise<void> {
    const cached = await this.repository.get(mintUrl)
    if (!cached) {
      await this.fetchAndCache(mintUrl)
    }
  }

  /**
   * Clear all cached metadata
   */
  async clearCache(): Promise<void> {
    await this.repository.clear()
  }

  /**
   * Get display name for a mint (from cache or fallback to hostname)
   */
  async getDisplayName(mintUrl: string): Promise<string> {
    const metadata = await this.repository.get(mintUrl)
    if (metadata?.name) return metadata.name
    return this.extractHostname(mintUrl)
  }

  /**
   * Get icon URL for a mint (from cache)
   */
  async getIconUrl(mintUrl: string): Promise<string | undefined> {
    const metadata = await this.repository.get(mintUrl)
    return metadata?.iconUrl
  }

  /**
   * Extract hostname from URL as fallback display name
   */
  extractHostname(url: string): string {
    try {
      const parsed = new URL(url)
      return parsed.hostname
    } catch {
      return url
    }
  }

  private async doFetch(mintUrl: string): Promise<MintMetadata | null> {
    try {
      const infoUrl = `${mintUrl.replace(/\/$/, '')}/v1/info`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.MINT_REQUEST)

      const response = await fetch(infoUrl, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        console.warn(`[MintMetadata] Failed to fetch info for ${mintUrl}: ${response.status}`)
        return null
      }

      const info: MintInfoResponse = await response.json()

      const metadata: MintMetadata = {
        url: mintUrl,
        name: info.name,
        iconUrl: info.icon_url,
        description: info.description,
        pubkey: info.pubkey,
        fetchedAt: Date.now(),
      }

      await this.repository.save(metadata)
      metadataEvents.emit(mintUrl, metadata)
      return metadata
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[MintMetadata] Timeout fetching info for ${mintUrl}`)
      } else {
        console.warn(`[MintMetadata] Error fetching info for ${mintUrl}:`, error)
      }
      return null
    }
  }

  private isStale(metadata: MintMetadata): boolean {
    return Date.now() - metadata.fetchedAt > METADATA_REFRESH_INTERVAL
  }

  private refreshInBackground(mintUrl: string): void {
    // Fire and forget refresh
    this.fetchAndCache(mintUrl).catch(() => {
      // Ignore errors - we still have cached data
    })
  }
}

export const mintMetadataService = new MintMetadataService()
