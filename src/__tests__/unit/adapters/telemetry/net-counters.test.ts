import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  incrementNetCounter,
  flushNetCounters,
  peekPendingNetCounters,
  readNetCounters,
  startNetCounterFlusher,
} from '@/adapters/telemetry/net-counters'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'

describe('net-counters', () => {
  beforeEach(async () => {
    await resetDatabase()
    // 이전 테스트의 미flush 델타 제거
    await flushNetCounters()
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  it('accumulates increments in memory without touching Dexie', async () => {
    incrementNetCounter('coco_push_received')
    incrementNetCounter('coco_push_received', 2)

    expect(peekPendingNetCounters().get('coco_push_received')).toBe(3)
    const stored = await getDatabase().netCounters.get('coco_push_received')
    expect(stored).toBeUndefined()
  })

  it('flush adds deltas into Dexie and clears memory', async () => {
    incrementNetCounter('giftwrap_events_received', 5)
    await flushNetCounters()

    expect(peekPendingNetCounters().size).toBe(0)
    const stored = await getDatabase().netCounters.get('giftwrap_events_received')
    expect(stored?.value).toBe(5)

    incrementNetCounter('giftwrap_events_received', 2)
    await flushNetCounters()
    const updated = await getDatabase().netCounters.get('giftwrap_events_received')
    expect(updated?.value).toBe(7)
  })

  it('readNetCounters merges persisted values with pending deltas', async () => {
    incrementNetCounter('giftwrap_events_deduped', 4)
    await flushNetCounters()
    incrementNetCounter('giftwrap_events_deduped', 1)

    const counters = await readNetCounters()
    expect(counters.giftwrap_events_deduped).toBe(5)
    expect(counters.tls_stuck_detected).toBe(0)
  })

  // fake timers는 fake-indexeddb의 내부 비동기까지 얼려 Dexie flush가 완료되지 않는다
  // — 실타이머 + 짧은 주기로 검증한다.
  it('startNetCounterFlusher flushes on interval and on stop', async () => {
    const stop = startNetCounterFlusher(50)

    incrementNetCounter('coco_push_received')
    await vi.waitFor(() => {
      expect(peekPendingNetCounters().size).toBe(0)
    })

    incrementNetCounter('coco_push_received')
    stop()

    await vi.waitFor(async () => {
      const stored = await getDatabase().netCounters.get('coco_push_received')
      expect(stored?.value).toBe(2)
    })
    expect(peekPendingNetCounters().size).toBe(0)
  })
})
