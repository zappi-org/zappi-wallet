import type { MintInfoData } from '@/core/types'

/**
 * Driving port for mint info lookups — sole owner of /v1/info.
 *
 * Used by detail screens (MintInfoSheet, MintManagement expansion) and trust-add
 * verification. Previously 3 screens each did a raw fetch, bypassing the limiter and
 * ignoring the 24h metadata cache — now a cache hit means zero network.
 */
export interface MintInfoUseCase {
  /**
   * NUT-06 raw info. Defaults to the 24h metadata cache.
   * fresh=true probes immediately (a lightweight round-trip) — only when the goal is
   * to verify "alive and valid right now", e.g. adding trust. The probe response is
   * also back-injected into the metadata cache.
   */
  getInfo(mintUrl: string, opts?: { fresh?: boolean }): Promise<MintInfoData | null>
}
