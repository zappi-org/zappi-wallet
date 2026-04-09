import type { MintHealthChecker, MintHealthStatus } from '@/core/ports/driven/mint-health-checker.port'

const CACHE_TTL_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000

/**
 * Mint health checker via HTTP.
 * Moved from ui/services/mint-health to adapters/ layer.
 */
export class MintHealthCheckerAdapter implements MintHealthChecker {
  private cache = new Map<string, MintHealthStatus>()

  async checkMint(mintUrl: string): Promise<MintHealthStatus> {
    const cached = this.cache.get(mintUrl)
    if (cached && Date.now() - cached.lastChecked < CACHE_TTL_MS) {
      return { ...cached, checkMethod: 'cached' }
    }

    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const infoUrl = `${mintUrl.replace(/\/+$/, '')}/v1/info`
      const response = await fetch(infoUrl, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const status: MintHealthStatus = {
        url: mintUrl,
        isOnline: response.ok,
        lastChecked: Date.now(),
        responseTimeMs: Date.now() - start,
        checkMethod: 'http',
      }
      this.cache.set(mintUrl, status)
      return status
    } catch (error) {
      const status: MintHealthStatus = {
        url: mintUrl,
        isOnline: false,
        lastChecked: Date.now(),
        responseTimeMs: Date.now() - start,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        checkMethod: 'http',
      }
      this.cache.set(mintUrl, status)
      return status
    }
  }

  async checkAllMints(urls: string[]): Promise<MintHealthStatus[]> {
    return Promise.all(urls.map((url) => this.checkMint(url)))
  }

  getCached(mintUrl: string): MintHealthStatus | null {
    return this.cache.get(mintUrl) ?? null
  }
}
