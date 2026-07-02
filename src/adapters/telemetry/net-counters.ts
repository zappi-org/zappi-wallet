/**
 * Net counters — 프로덕션 집계 카운터 (설계 §12)
 *
 * PII 없는 누적 카운터만. 원격 전송 없음 — 진단 화면 열람·지원 시 수동 공유용.
 * 5단계(TLS 강등) 게이트의 검증 프로토콜이 이 수치를 근거로 한다.
 *
 * 쓰기 정책: 이벤트당 Dexie 쓰기 금지 — catch-up replay 핫패스는 NIP-44 복호화와
 * 같은 스레드다. 메모리 누적 후 30초 주기 + pagehide/onPause에 flush한다.
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

/** 테스트용 — 미flush 델타 조회. */
export function peekPendingNetCounters(): ReadonlyMap<NetCounterName, number> {
  return new Map(pending)
}

/**
 * 메모리 델타를 Dexie에 합산. 실패 시 델타를 메모리로 되돌려 다음 주기에 재시도.
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
    // flush 실패(스토리지 불가 등) — 유실 대신 재큐잉
    for (const [name, delta] of deltas) {
      pending.set(name, (pending.get(name) ?? 0) + delta)
    }
  }
}

/**
 * 주기 flush 시작. 반환된 함수로 정지(마지막 flush 포함).
 * bootstrap activate에서 1회 시작하고, onPause에서는 flushNetCounters()를 직접 호출한다.
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

/** 진단 화면용 — 영속값 + 미flush 델타 합산 조회. */
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
    // 스토리지 불가 — 메모리 값만 반환
  }

  return result
}
