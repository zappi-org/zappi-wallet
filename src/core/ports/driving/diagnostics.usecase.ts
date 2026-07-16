/**
 * DiagnosticsUseCase — read-only surface for the diagnostics screen.
 *
 * The counter implementation (adapters/telemetry/net-counters) is injected by
 * the composition root. The UI depends only on this port, cutting direct
 * ui→adapters imports.
 */
export interface DiagnosticsUseCase {
  /** PII-free cumulative counter snapshot (includes summed unflushed in-memory deltas) */
  readNetCounters(): Promise<Record<string, number>>
}
