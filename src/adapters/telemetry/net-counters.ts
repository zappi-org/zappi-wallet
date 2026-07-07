/**
 * Net counters — production aggregate counters.
 *
 * PII-free cumulative counters only. No remote transmission — for manual sharing
 * when viewing diagnostics or contacting support. These numbers back the
 * validation protocol for the TLS-downgrade gate.
 *
 * Write policy: no Dexie write per event — the catch-up replay hot path shares a
 * thread with NIP-44 decryption. Accumulate in memory, then flush every 30s plus
 * on pagehide/onPause.
 */

import { getDatabase } from '@/adapters/storage/dexie/schema'

export const NET_COUNTER_NAMES = [
  'coco_push_received',
  'tls_stuck_detected',
  'tls_stuck_confirmed_settled',
  'giftwrap_events_received',
  'giftwrap_events_deduped',
  'relay_notice_rate_limited',
] as const

export type NetCounterName = (typeof NET_COUNTER_NAMES)[number]

const FLUSH_INTERVAL_MS = 30_000

const pending = new Map<NetCounterName, number>()

export function incrementNetCounter(name: NetCounterName, by = 1): void {
  pending.set(name, (pending.get(name) ?? 0) + by)
}

/** Test helper — read un-flushed deltas. */
export function peekPendingNetCounters(): ReadonlyMap<NetCounterName, number> {
  return new Map(pending)
}

/**
 * Merge in-memory deltas into Dexie. On failure, restore the deltas to memory to
 * retry on the next cycle.
 */
export async function flushNetCounters(): Promise<void> {
  if (pending.size === 0) return

  const deltas = [...pending.entries()]
  pending.clear()

  try {
    const db = getDatabase()
    await db.transaction('rw', db.netCounters, async () => {
      for (const [name, delta] of deltas) {
        const existing = await db.netCounters.get(name)
        await db.netCounters.put({
          name,
          value: (existing?.value ?? 0) + delta,
          updatedAt: Date.now(),
        })
      }
    })
  } catch {
    // flush failed (storage unavailable, etc.) — re-queue instead of dropping
    for (const [name, delta] of deltas) {
      pending.set(name, (pending.get(name) ?? 0) + delta)
    }
  }
}

/**
 * Start periodic flushing. The returned function stops it (with a final flush).
 * Started once in bootstrap activate; onPause calls flushNetCounters() directly.
 */
export function startNetCounterFlusher(intervalMs = FLUSH_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    void flushNetCounters()
  }, intervalMs)

  const handlePageHide = () => {
    void flushNetCounters()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePageHide)
  }

  return () => {
    clearInterval(timer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', handlePageHide)
    }
    void flushNetCounters()
  }
}

/** Diagnostics — read persisted values plus un-flushed deltas. */
export async function readNetCounters(): Promise<Record<NetCounterName, number>> {
  const result = {} as Record<NetCounterName, number>
  for (const name of NET_COUNTER_NAMES) {
    result[name] = pending.get(name) ?? 0
  }

  try {
    const db = getDatabase()
    const rows = await db.netCounters.toArray()
    for (const row of rows) {
      if ((NET_COUNTER_NAMES as readonly string[]).includes(row.name)) {
        result[row.name as NetCounterName] += row.value
      }
    }
  } catch {
    // storage unavailable — return in-memory values only
  }

  return result
}
