import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installViewportScrollRestore } from '@/ui/utils/viewport-scroll-restore'

type Listener = () => void

function mockVisualViewport(height: number) {
  const listeners = new Map<string, Listener[]>()
  const vv = {
    height,
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
  }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  return vv
}

function setWindowScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true })
}

describe('installViewportScrollRestore', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    scrollToSpy = vi.fn()
    Object.defineProperty(window, 'scrollTo', { value: scrollToSpy, configurable: true })
    setWindowScrollY(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
  })

  it('snaps the window back when the viewport regrows (keyboard closed)', () => {
    const vv = mockVisualViewport(800)
    installViewportScrollRestore()

    // Keyboard opens: viewport shrinks — no reset (iOS owns this state).
    vv.height = 500
    vv.fire('resize')
    expect(scrollToSpy).not.toHaveBeenCalled()

    // Keyboard closes with a stale scroll offset left behind.
    setWindowScrollY(48)
    vv.height = 800
    vv.fire('resize')
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)

    // The settle pass re-checks after the keyboard animation finishes.
    scrollToSpy.mockClear()
    setWindowScrollY(48)
    vi.advanceTimersByTime(250)
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)
  })

  it('does not scroll when the window is already at the origin', () => {
    const vv = mockVisualViewport(800)
    installViewportScrollRestore()

    vv.height = 500
    vv.fire('resize')
    vv.height = 800
    vv.fire('resize')
    vi.advanceTimersByTime(250)
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('resets on pageshow and on returning to visible', () => {
    mockVisualViewport(800)
    installViewportScrollRestore()

    setWindowScrollY(30)
    window.dispatchEvent(new Event('pageshow'))
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)

    scrollToSpy.mockClear()
    setWindowScrollY(30)
    document.dispatchEvent(new Event('visibilitychange'))
    // jsdom documents report 'visible' by default.
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)
  })
})
