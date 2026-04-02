import type { MintMetadata } from '@/core/types'
import { TIMEOUTS } from '@/core/constants'
import { metadataEvents } from './metadata-events'

/**
 * Storage interface for mint metadata.
 * Implemented by data layer (e.g. Dexie repository).
 */
export interface MetadataStore {
  get(mintUrl: string): Promise<MintMetadata | null>
  getMany(mintUrls: string[]): Promise<Map<string, MintMetadata>>
  save(metadata: MintMetadata): Promise<void>
  clear(): Promise<void>
}

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

// ─── NUT query helpers ───

/**
 * Check if a mint supports a given NUT.
 * Handles both { supported: true } and { methods: [...], disabled: false } patterns.
 */
export function nutSupported(nuts: Record<string, unknown> | undefined, nut: number): boolean {
  if (!nuts) return false
  const entry = nuts[String(nut)]
  if (!entry || typeof entry !== 'object') return false

  const obj = entry as Record<string, unknown>

  // Explicitly disabled
  if (obj.disabled === true) return false

  // { supported: true } or { supported: [...] }
  if ('supported' in obj) {
    return obj.supported === true || Array.isArray(obj.supported)
  }

  // { methods: [...] } — presence means supported
  if ('methods' in obj && Array.isArray(obj.methods)) {
    return obj.methods.length > 0
  }

  // Any other object with fields = supported (e.g. NUT-19 { ttl, cached_endpoints }, NUT-29 { max_batch_size })
  return Object.keys(obj).length > 0
}

/** Payment method info from NUT-06 methods array */
export interface NutMethod {
  method: string
  unit: string
  minAmount?: number
  maxAmount?: number
}

/**
 * Get payment methods for a NUT (e.g. NUT 4, 5, 15, 23, 25).
 * Returns empty array if NUT has no methods field.
 */
export function nutMethods(nuts: Record<string, unknown> | undefined, nut: number): NutMethod[] {
  if (!nuts) return []
  const entry = nuts[String(nut)]
  if (!entry || typeof entry !== 'object') return []

  const obj = entry as Record<string, unknown>
  if (!Array.isArray(obj.methods)) return []

  return obj.methods.map((m: unknown) => {
    const method = m as Record<string, unknown>
    return {
      method: String(method.method ?? ''),
      unit: String(method.unit ?? ''),
      minAmount: typeof method.min_amount === 'number' ? method.min_amount : undefined,
      maxAmount: typeof method.max_amount === 'number' ? method.max_amount : undefined,
    }
  })
}

/**
 * Get raw NUT config for advanced queries (e.g. NUT-17 commands, NUT-19 ttl, NUT-29 max_batch_size).
 */
export function nutConfig(nuts: Record<string, unknown> | undefined, nut: number): unknown {
  if (!nuts) return undefined
  return nuts[String(nut)]
}

/**
 * Refresh interval for mint metadata (24 hours)
 */
const METADATA_REFRESH_INTERVAL = 24 * 60 * 60 * 1000

/**
 * Service for fetching and caching mint metadata (NUT-06)
 * Supports offline-first operation with injected storage.
 */
export class MintMetadataService {
  private inFlightRequests = new Map<string, Promise<MintMetadata | null>>()

  constructor(private store: MetadataStore) {}

  /**
   * Get metadata for a mint (from cache if available, fetch if needed)
   */
  async getMetadata(mintUrl: string): Promise<MintMetadata | null> {
    const cached = await this.store.get(mintUrl)

    if (cached && !this.isStale(cached)) {
      return cached
    }

    if (cached) {
      this.refreshInBackground(mintUrl)
      return cached
    }

    return this.fetchAndCache(mintUrl)
  }

  /**
   * Get metadata for multiple mints
   */
  async getMetadataForMints(mintUrls: string[]): Promise<Map<string, MintMetadata>> {
    const cachedMap = await this.store.getMany(mintUrls)

    const needsFetch = mintUrls.filter((url) => !cachedMap.has(url))

    if (needsFetch.length > 0) {
      const fetchPromises = needsFetch.map((url) => this.fetchAndCache(url))
      const results = await Promise.allSettled(fetchPromises)

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          cachedMap.set(needsFetch[index], result.value)
        }
      })
    }

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
   * Fetch metadata only if not cached
   */
  async refreshIfMissing(mintUrl: string): Promise<void> {
    const cached = await this.store.get(mintUrl)
    if (!cached) {
      await this.fetchAndCache(mintUrl)
    }
  }

  /**
   * Clear all cached metadata
   */
  async clearCache(): Promise<void> {
    await this.store.clear()
  }

  /**
   * Get display name for a mint (from cache or fallback to hostname)
   */
  async getDisplayName(mintUrl: string): Promise<string> {
    const metadata = await this.store.get(mintUrl)
    if (metadata?.name) return metadata.name
    return this.extractHostname(mintUrl)
  }

  /**
   * Get icon URL for a mint (from cache)
   */
  async getIconUrl(mintUrl: string): Promise<string | undefined> {
    const metadata = await this.store.get(mintUrl)
    return metadata?.iconUrl
  }

  /**
   * Check if mint supports a specific NUT
   */
  async supports(mintUrl: string, nut: number): Promise<boolean> {
    const metadata = await this.getMetadata(mintUrl)
    return nutSupported(metadata?.nuts, nut)
  }

  /**
   * Get payment methods for a specific NUT
   */
  async getMethods(mintUrl: string, nut: number): Promise<NutMethod[]> {
    const metadata = await this.getMetadata(mintUrl)
    return nutMethods(metadata?.nuts, nut)
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
        nuts: info.nuts,
      }

      await this.store.save(metadata)
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
    this.fetchAndCache(mintUrl).catch(() => {})
  }
}
