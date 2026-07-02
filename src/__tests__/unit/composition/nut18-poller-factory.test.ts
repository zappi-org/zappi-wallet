import { describe, it, expect, vi } from 'vitest'
import { createNut18HttpPollerFactory } from '@/composition/nut18-poller-factory'
import type { startNut18HttpPoller } from '@/adapters/codec/nut18-http-poller'

type StartFn = typeof startNut18HttpPoller

function createStartSpy() {
  const handle = {
    cancel: vi.fn(),
    onPayment: vi.fn(),
    onError: vi.fn(),
  }
  const start = vi.fn<StartFn>(() => handle)
  return { start, handle }
}

describe('createNut18HttpPollerFactory', () => {
  /**
   * 회귀 감시의 핵심 — 배선 필드 전수 스냅샷.
   * 과거 bootstrap 인라인 팩토리가 expiresAt을 버려 만료 후에도 3초 폴링이
   * 최장 30분 지속됐다 (설계 §8.1). 필드가 늘면 이 테스트를 함께 갱신할 것.
   */
  it('forwards EVERY poller option — expiresAt included', () => {
    const { start } = createStartSpy()
    const factory = createNut18HttpPollerFactory(start)

    factory({
      endpoint: 'https://mint.example/pr/abc',
      requestId: 'req-1',
      intervalMs: 3_000,
      maxDurationMs: 60_000,
      expiresAt: 1_751_400_000_000,
    })

    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({
      endpoint: 'https://mint.example/pr/abc',
      requestId: 'req-1',
      intervalMs: 3_000,
      maxDurationMs: 60_000,
      expiresAt: 1_751_400_000_000,
    })
  })

  it('forwards optional fields as undefined when omitted (poller defaults apply)', () => {
    const { start } = createStartSpy()
    const factory = createNut18HttpPollerFactory(start)

    factory({ endpoint: 'https://mint.example/pr/abc', requestId: 'req-2' })

    expect(start).toHaveBeenCalledWith({
      endpoint: 'https://mint.example/pr/abc',
      requestId: 'req-2',
      intervalMs: undefined,
      maxDurationMs: undefined,
      expiresAt: undefined,
    })
  })

  it('maps the poller handle onto the Poller port (stop=cancel)', () => {
    const { start, handle } = createStartSpy()
    const factory = createNut18HttpPollerFactory(start)

    const poller = factory({ endpoint: 'e', requestId: 'r' })
    poller.stop()
    expect(handle.cancel).toHaveBeenCalledTimes(1)

    const onPayment = vi.fn()
    poller.onPayment(onPayment)
    expect(handle.onPayment).toHaveBeenCalledWith(onPayment)

    const onError = vi.fn()
    poller.onError(onError)
    expect(handle.onError).toHaveBeenCalledWith(onError)
  })
})
