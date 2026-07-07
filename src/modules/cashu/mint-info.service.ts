/**
 * MintInfoService — sole owner of /v1/info.
 *
 * Implements two roles in one class:
 * 1. MintHealthChecker (driven port): 30s-freshness health probe. Drop-in
 *    replacement for MintHealthCheckerAdapter, so the health facade, driving
 *    port, and UI are unchanged.
 * 2. MintInfoUseCase (driving port): raw NUT-06 info for the detail screen,
 *    24h metadata cache first (zero network on cache hit).
 *
 * Eliminating the double-hit: the probe (one lightweight round-trip) back-injects
 * its success response into metadata via MintMetadataService.ingest, so health
 * and metadata no longer hit the same endpoint separately in one refresh cycle.
 *
 * The probe is the only direct mint fetch left in this codebase — health asks
 * "is it alive right now" and needs a real round-trip, while Coco's getMintInfo
 * is a 5min-TTL repo hybrid unfit for 30s freshness.
 */

import type {
  MintHealthChecker,
  MintHealthStatus,
} from '@/core/ports/driven/mint-health-checker.port'
import type { MintInfoUseCase } from '@/core/ports/driving/mint-info.usecase'
import type { MintInfoData, MintMetadata } from '@/core/types'
import { netLog } from '@/core/utils/net-log'
import type { MintMetadataService, MintInfoResponse } from './internal/mint-metadata'

const HEALTH_TTL_MS = 30_000
const PROBE_TIMEOUT_MS = 10_000

interface ProbeOutcome {
  status: MintHealthStatus
  info: MintInfoData | null
}

export class MintInfoService implements MintHealthChecker, MintInfoUseCase {
  /** In-memory mirror of health snapshots — synchronous source for getCached. */
  private readonly mirror = new Map<string, MintHealthStatus>()
  /**
   * De-dupes concurrent probe(url) calls — in-flight map keyed by mintUrl.
   * A custom map instead of RequestGate because metadata (branch A) needs to
   * look up the in-flight probe to join it (see joinProbeAsMetadata below).
   */
  private readonly probeInFlight = new Map<string, Promise<ProbeOutcome>>()

  constructor(private readonly metadata: MintMetadataService) {
    // Cross-branch in-flight sharing: on Home mount, the health probe and
    // metadata refresh fire together in the same commit — a deterministic
    // duplicate. Metadata's cache-miss/stale path joins the in-flight probe for
    // the same mint, finishing in one round-trip.
    this.metadata.setProbeJoiner((mintUrl) => this.joinProbeAsMetadata(mintUrl))
  }

  // ─── MintHealthChecker ───

  async checkMint(mintUrl: string): Promise<MintHealthStatus> {
    const cached = this.mirror.get(mintUrl)
    if (cached && Date.now() - cached.lastChecked < HEALTH_TTL_MS) {
      return { ...cached, checkMethod: 'cached' }
    }

    const { status } = await this.runProbe(mintUrl)
    return status
  }

  async checkAllMints(urls: string[]): Promise<MintHealthStatus[]> {
    return Promise.all(urls.map((url) => this.checkMint(url)))
  }

  getCached(mintUrl: string): MintHealthStatus | null {
    return this.mirror.get(mintUrl) ?? null
  }

  // ─── MintInfoUseCase ───

  async getInfo(
    mintUrl: string,
    opts?: { fresh?: boolean },
  ): Promise<MintInfoData | null> {
    if (opts?.fresh) {
      // Accepted trade-off: a fresh probe back-injects any 2xx response into
      // metadata regardless of validation — cache warming for mints that will be
      // trusted; for URLs the user typed but never added, it leaves a few stray
      // cache rows (bounded by user action, harmless).
      const { info } = await this.runProbe(mintUrl)
      return info
    }

    const cached = await this.metadata.getMetadata(mintUrl)
    if (cached?.rawInfo) {
      return cached.rawInfo as MintInfoData
    }

    // Old cache without rawInfo (record predates the field) — force a refresh.
    const refreshed = await this.metadata.refresh(mintUrl)
    return (refreshed?.rawInfo as MintInfoData | undefined) ?? null
  }

  // ─── Probe (lightweight /v1/info round-trip — no keysets) ───

  private runProbe(mintUrl: string): Promise<ProbeOutcome> {
    const existing = this.probeInFlight.get(mintUrl)
    if (existing) return existing

    const promise = this.probe(mintUrl).finally(() => this.probeInFlight.delete(mintUrl))
    this.probeInFlight.set(mintUrl, promise)
    return promise
  }

  /**
   * Branch A join point: if a probe for this mint is in flight, return the cache
   * record after it completes (including ingest) as the metadata result. No probe
   * in flight → null, so branch A fetches directly.
   */
  private joinProbeAsMetadata(mintUrl: string): Promise<MintMetadata | null> | null {
    const inflight = this.probeInFlight.get(mintUrl)
    if (!inflight) return null
    return inflight.then((outcome) =>
      outcome.status.isOnline ? this.metadata.peekCached(mintUrl) : null,
    )
  }

  /**
   * Intentional semantic difference from the old adapter: the old code never read
   * the body, so any 2xx counted as online (even a captive portal's fake 200). The
   * probe requires a successful JSON parse to count as online — a parse failure is
   * judged offline.
   */
  private async probe(mintUrl: string): Promise<ProbeOutcome> {
    const start = Date.now()
    const infoUrl = `${mintUrl.replace(/\/+$/, '')}/v1/info`
    netLog({ layer: 'mint', op: 'fetch', key: mintUrl, detail: '/v1/info', caller: 'mint-info' })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      const response = await fetch(infoUrl, { method: 'GET', signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return this.record(mintUrl, start, false, `HTTP ${response.status}`)
      }

      const info = (await response.json()) as MintInfoResponse
      // Back-inject — refresh the metadata cache with the same response. Awaited
      // because the join point reads via peekCached right after the probe
      // completes, so the store must land first.
      await this.metadata.ingest(mintUrl, info).catch(() => {})

      const outcome = this.record(mintUrl, start, true)
      return { ...outcome, info: info as unknown as MintInfoData }
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'timeout'
          : error instanceof Error
            ? error.message
            : 'Unknown error'
      return this.record(mintUrl, start, false, message)
    }
  }

  private record(
    mintUrl: string,
    startedAt: number,
    isOnline: boolean,
    errorMessage?: string,
  ): ProbeOutcome {
    const status: MintHealthStatus = {
      url: mintUrl,
      isOnline,
      lastChecked: Date.now(),
      responseTimeMs: Date.now() - startedAt,
      checkMethod: 'http',
      ...(errorMessage ? { errorMessage } : {}),
    }
    this.mirror.set(mintUrl, status)
    return { status, info: null }
  }
}
