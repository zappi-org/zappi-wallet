import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installViewportScrollRestore } from '@/ui/utils/viewport-scroll-restore'

type Listener = () => void

function mockVisualViewport(height: number) {
  const listeners = new Map<string, Listener[]>()
  const vv = {
    height,
    pageTop: 0,
    offsetTop: 0,
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

  it('jogs the window back when the viewport regrows with a hidden offset', () => {
    const vv = mockVisualViewport(800)
    installViewportScrollRestore()

    // Keyboard opens: viewport shrinks — no reset (iOS owns this state).
    vv.height = 500
    vv.fire('resize')
    expect(scrollToSpy).not.toHaveBeenCalled()

    // Keyboard closes; scrollY lies (0) but the visual viewport is displaced —
    // the stuck state a manual drag fixes.
    vv.pageTop = 48
    vv.height = 800
    vv.fire('resize')
    // The jog is a REAL scroll op (0→1→0), not a no-op scrollTo(0,0).
    expect(scrollToSpy).toHaveBeenNthCalledWith(1, 0, 1)
    expect(scrollToSpy).toHaveBeenNthCalledWith(2, 0, 0)

    // The settle passes re-check after the keyboard animation finishes.
    scrollToSpy.mockClear()
    vv.pageTop = 48
    vi.advanceTimersByTime(600)
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)
  })

  it('does not scroll when the window is already at the origin', () => {
    const vv = mockVisualViewport(800)
    installViewportScrollRestore()

    vv.height = 500
    vv.fire('resize')
    vv.height = 800
    vv.fire('resize')
    vi.advanceTimersByTime(600)
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('checks after focusout when the input unmounts without a resize event', () => {
    mockVisualViewport(800)
    installViewportScrollRestore()

    window.dispatchEvent(new Event('focusout'))
    setWindowScrollY(40)
    vi.advanceTimersByTime(350)
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)
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
