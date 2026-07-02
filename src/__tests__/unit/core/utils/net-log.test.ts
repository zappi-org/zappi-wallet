import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  netLog,
  netLogClear,
  netLogDump,
  netLogDuplicates,
  setNetLogEnabled,
} from '@/core/utils/net-log'

describe('net-log', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T00:00:00Z'))
    setNetLogEnabled(true)
    netLogClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    netLogClear()
  })

  it('records entries with a timestamp', () => {
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.a', detail: '/v1/info', caller: 'health' })

    const dump = netLogDump()
    expect(dump).toHaveLength(1)
    expect(dump[0]).toMatchObject({ layer: 'mint', op: 'fetch', key: 'https://mint.a', caller: 'health' })
    expect(dump[0].t).toBe(Date.now())
  })

  it('does nothing when disabled', () => {
    setNetLogEnabled(false)
    netLog({ layer: 'mint', op: 'fetch', key: 'x', detail: 'y', caller: 'z' })
    expect(netLogDump()).toHaveLength(0)
  })

  it('keeps at most 1000 entries in ring order (oldest dropped first)', () => {
    for (let i = 0; i < 1_005; i++) {
      netLog({ layer: 'relay', op: 'sub', key: `r${i}`, detail: 'd', caller: 'c' })
    }

    const dump = netLogDump()
    expect(dump).toHaveLength(1_000)
    expect(dump[0].key).toBe('r5')
    expect(dump[999].key).toBe('r1004')
  })

  it('duplicates() reports same-signature entries within the window', () => {
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.a', detail: '/v1/info', caller: 'health' })
    vi.advanceTimersByTime(1_000)
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.a', detail: '/v1/info', caller: 'metadata' })

    const dups = netLogDuplicates(5_000)
    expect(dups).toHaveLength(1)
    expect(dups[0].count).toBe(2)
    expect(dups[0].callers.sort()).toEqual(['health', 'metadata'])
  })

  it('duplicates() ignores same-signature entries farther apart than the window', () => {
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.a', detail: '/v1/info', caller: 'health' })
    vi.advanceTimersByTime(60_000)
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.a', detail: '/v1/info', caller: 'health' })

    expect(netLogDuplicates(5_000)).toHaveLength(0)
  })

  it('duplicates() separates different signatures', () => {
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.a', detail: '/v1/info', caller: 'health' })
    netLog({ layer: 'mint', op: 'fetch', key: 'https://mint.b', detail: '/v1/info', caller: 'health' })

    expect(netLogDuplicates(5_000)).toHaveLength(0)
  })
})
