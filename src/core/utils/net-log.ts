/**
 * NetLog — dev 전용 네트워크 발화 계측 (설계 §12)
 *
 * 링버퍼 1000건. 프로덕션 빌드에서는 emit이 no-op이다(enabled=false).
 * dev 콘솔: `__netlog.dump()`, `__netlog.duplicates(windowMs)`, `__netlog.clear()`.
 *
 * duplicates()는 같은 (layer|op|key|detail) 서명이 windowMs 내에 반복 발화한
 * 클러스터를 찾는다 — "같은 endpoint를 누가 겹쳐 때리는가"의 1차 증거.
 */

export type NetLogLayer = 'mint' | 'relay'
export type NetLogOp = 'fetch' | 'ws-open' | 'sub' | 'query' | 'publish' | 'eose'

export interface NetLogEntry {
  t: number
  layer: NetLogLayer
  op: NetLogOp
  /** mintUrl 또는 relayUrl */
  key: string
  /** endpoint · kinds · subId 등 식별 상세 */
  detail: string
  /** 발화 주체 태그 — §5.4 예외 목록 감시의 근거 */
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

/** 테스트/진단용 강제 토글. */
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

    // windowMs 내 인접 발화가 하나라도 있으면 클러스터로 보고
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

// dev 콘솔 접근자
if (enabled && typeof globalThis !== 'undefined') {
  ;(globalThis as Record<string, unknown>).__netlog = {
    dump: netLogDump,
    duplicates: netLogDuplicates,
    clear: netLogClear,
  }
}
