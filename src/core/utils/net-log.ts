/**
 * NetLog — dev-only network-emission instrumentation.
 *
 * 1000-entry ring buffer. emit is a no-op in production builds (enabled=false).
 * dev console: `__netlog.dump()`, `__netlog.duplicates(windowMs)`, `__netlog.clear()`.
 *
 * duplicates() finds clusters where the same (layer|op|key|detail) signature
 * fired repeatedly within windowMs — first evidence of who is hammering the same
 * endpoint.
 */

export type NetLogLayer = 'mint' | 'relay'
export type NetLogOp = 'fetch' | 'ws-open' | 'sub' | 'query' | 'publish' | 'eose'

export interface NetLogEntry {
  t: number
  layer: NetLogLayer
  op: NetLogOp
  /** mintUrl or relayUrl */
  key: string
  /** identifying detail: endpoint, kinds, subId, etc. */
  detail: string
  /** emitter tag */
  caller: string
}

export interface NetLogDuplicate {
  signature: string
  count: number
  callers: string[]
  firstAt: number
  lastAt: number
}

const CAPACITY = 1_000

let enabled: boolean = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)
const buffer: NetLogEntry[] = []
let head = 0

/** Force-toggle for tests/diagnostics. */
export function setNetLogEnabled(on: boolean): void {
  enabled = on
}

export function netLog(entry: Omit<NetLogEntry, 't'>): void {
  if (!enabled) return
  const full: NetLogEntry = { t: Date.now(), ...entry }
  if (buffer.length < CAPACITY) {
    buffer.push(full)
  } else {
    buffer[head] = full
    head = (head + 1) % CAPACITY
  }
}

export function netLogDump(): NetLogEntry[] {
  if (buffer.length < CAPACITY) return [...buffer]
  return [...buffer.slice(head), ...buffer.slice(0, head)]
}

export function netLogClear(): void {
  buffer.length = 0
  head = 0
}

export function netLogDuplicates(windowMs = 5_000): NetLogDuplicate[] {
  const bySignature = new Map<string, NetLogEntry[]>()
  for (const entry of netLogDump()) {
    const signature = `${entry.layer}|${entry.op}|${entry.key}|${entry.detail}`
    const list = bySignature.get(signature)
    if (list) list.push(entry)
    else bySignature.set(signature, [entry])
  }

  const duplicates: NetLogDuplicate[] = []
  for (const [signature, list] of bySignature) {
    if (list.length < 2) continue
    list.sort((a, b) => a.t - b.t)

    // treat as a cluster if any adjacent pair fired within windowMs
    let clustered = false
    for (let i = 1; i < list.length; i++) {
      if (list[i].t - list[i - 1].t <= windowMs) {
        clustered = true
        break
      }
    }
    if (!clustered) continue

    duplicates.push({
      signature,
      count: list.length,
      callers: [...new Set(list.map((e) => e.caller))],
      firstAt: list[0].t,
      lastAt: list[list.length - 1].t,
    })
  }

  return duplicates.sort((a, b) => b.count - a.count)
}

// dev console accessor
if (enabled && typeof globalThis !== 'undefined') {
  ;(globalThis as Record<string, unknown>).__netlog = {
    dump: netLogDump,
    duplicates: netLogDuplicates,
    clear: netLogClear,
  }
}
