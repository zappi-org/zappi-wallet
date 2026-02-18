/**
 * Mint Health Service
 * Checks mint server online status with caching and deduplication
 * Supports WebSocket (wss) and HTTP with CORS error handling
 */

export interface MintHealthStatus {
  url: string
  isOnline: boolean
  lastChecked: number
  responseTimeMs?: number
  errorMessage?: string
  checkMethod?: 'websocket' | 'http' | 'cached'
}

const CHECK_TIMEOUT = 5000 // 5 seconds
const WS_CHECK_TIMEOUT = 3000 // 3 seconds for WebSocket
const CACHE_TTL = 30000 // 30 seconds cache validity

class MintHealthService {
  private cache = new Map<string, MintHealthStatus>()
  private pending = new Map<string, Promise<MintHealthStatus>>()

  /**
   * Check single mint status (with deduplication and caching)
   */
  async checkMint(mintUrl: string): Promise<MintHealthStatus> {
    const normalizedUrl = mintUrl.replace(/\/+$/, '')

    // Check cache first (if still valid)
    const cached = this.cache.get(normalizedUrl)
    if (cached && Date.now() - cached.lastChecked < CACHE_TTL) {
      return { ...cached, checkMethod: 'cached' }
    }

    // Return pending request if already in progress
    const existing = this.pending.get(normalizedUrl)
    if (existing) return existing

    const promise = this._doCheck(normalizedUrl)
    this.pending.set(normalizedUrl, promise)

    try {
      const result = await promise
      this.cache.set(normalizedUrl, result)
      return result
    } finally {
      this.pending.delete(normalizedUrl)
    }
  }

  private async _doCheck(mintUrl: string): Promise<MintHealthStatus> {
    const start = Date.now()

    // Try WebSocket first (no CORS issues)
    const wsResult = await this._checkViaWebSocket(mintUrl)
    if (wsResult.isOnline) {
      return {
        ...wsResult,
        responseTimeMs: Date.now() - start,
      }
    }

    // Fallback to HTTP with CORS handling
    const httpResult = await this._checkViaHttp(mintUrl)
    return {
      ...httpResult,
      responseTimeMs: Date.now() - start,
    }
  }

  /**
   * Check mint via WebSocket connection (no CORS restrictions)
   */
  private async _checkViaWebSocket(mintUrl: string): Promise<MintHealthStatus> {
    return new Promise((resolve) => {
      try {
        // Convert https:// to wss:// or http:// to ws://
        const wsUrl = mintUrl.replace(/^https?:\/\//, (protocol) =>
          protocol === 'https://' ? 'wss://' : 'ws://'
        ) + '/v1/ws'

        const ws = new WebSocket(wsUrl)
        const timeoutId = setTimeout(() => {
          ws.close()
          resolve({
            url: mintUrl,
            isOnline: false,
            lastChecked: Date.now(),
            errorMessage: 'WebSocket timeout',
            checkMethod: 'websocket',
          })
        }, WS_CHECK_TIMEOUT)

        ws.onopen = () => {
          clearTimeout(timeoutId)
          ws.close()
          resolve({
            url: mintUrl,
            isOnline: true,
            lastChecked: Date.now(),
            checkMethod: 'websocket',
          })
        }

        ws.onerror = () => {
          clearTimeout(timeoutId)
          ws.close()
          resolve({
            url: mintUrl,
            isOnline: false,
            lastChecked: Date.now(),
            errorMessage: 'WebSocket connection failed',
            checkMethod: 'websocket',
          })
        }
      } catch (e) {
        resolve({
          url: mintUrl,
          isOnline: false,
          lastChecked: Date.now(),
          errorMessage: e instanceof Error ? e.message : 'WebSocket error',
          checkMethod: 'websocket',
        })
      }
    })
  }

  /**
   * Check mint via HTTP fetch with CORS error handling
   */
  private async _checkViaHttp(mintUrl: string): Promise<MintHealthStatus> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT)

      const res = await fetch(`${mintUrl}/v1/info`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

      clearTimeout(timeoutId)

      return {
        url: mintUrl,
        isOnline: res.ok,
        lastChecked: Date.now(),
        checkMethod: 'http',
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'

      // CORS errors and network errors are different
      // A CORS error means the server responded but blocked the request
      // This could mean the mint is actually online
      const isCorsError = errorMessage.includes('CORS') ||
                          errorMessage.includes('NetworkError') ||
                          errorMessage.includes('Failed to fetch')

      // For CORS errors, assume the mint might be online (optimistic)
      // since the server at least responded
      if (isCorsError) {
        return {
          url: mintUrl,
          isOnline: true, // Optimistic: server responded but CORS blocked
          lastChecked: Date.now(),
          errorMessage: 'CORS (assumed online)',
          checkMethod: 'http',
        }
      }

      return {
        url: mintUrl,
        isOnline: false,
        lastChecked: Date.now(),
        errorMessage,
        checkMethod: 'http',
      }
    }
  }

  /**
   * Check all mints in parallel
   */
  async checkAllMints(urls: string[]): Promise<MintHealthStatus[]> {
    return Promise.all(urls.map((url) => this.checkMint(url)))
  }

  /**
   * Get cached status (no network request)
   */
  getCached(mintUrl: string): MintHealthStatus | null {
    const normalizedUrl = mintUrl.replace(/\/+$/, '')
    return this.cache.get(normalizedUrl) ?? null
  }

  /**
   * Find first online mint from the list (sequential check)
   */
  async findFirstOnlineMint(mintUrls: string[]): Promise<string | null> {
    for (const url of mintUrls) {
      const status = await this.checkMint(url)
      if (status.isOnline) {
        return url
      }
    }
    return null
  }

  /**
   * Select mint with fallback if preferred is offline
   */
  async selectMintWithFallback(
    preferredMint: string,
    allMints: string[]
  ): Promise<{ mintUrl: string; wasPreferred: boolean } | null> {
    // 1. Check preferred mint first
    const preferredStatus = await this.checkMint(preferredMint)
    if (preferredStatus.isOnline) {
      return { mintUrl: preferredMint, wasPreferred: true }
    }

    // 2. Fallback: check other mints sequentially
    const otherMints = allMints.filter(
      (m) => m.replace(/\/+$/, '') !== preferredMint.replace(/\/+$/, '')
    )
    const fallback = await this.findFirstOnlineMint(otherMints)

    if (fallback) {
      return { mintUrl: fallback, wasPreferred: false }
    }

    return null // All mints offline
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear()
  }
}

export const mintHealthService = new MintHealthService()
