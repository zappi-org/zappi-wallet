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

function mockStandalone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('display-mode: standalone') ? matches : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

function mockScreenHeight(value: number) {
  Object.defineProperty(window.screen, 'height', { value, configurable: true })
}

async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

describe('installViewportScrollRestore (standalone viewport un-stick)', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    scrollToSpy = vi.fn()
    Object.defineProperty(window, 'scrollTo', { value: scrollToSpy, configurable: true })
    mockScreenHeight(896)
    document.documentElement.style.height = ''
  })

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    document.documentElement.style.height = ''
  })

  it('jogs via a temporarily overheight document when the viewport collapses', async () => {
    mockStandalone(true)
    const vv = mockVisualViewport(896)
    installViewportScrollRestore()

    // WebKit collapses the dynamic viewport to the small value (no keyboard).
    vv.height = 852
    vv.fire('resize')
    // The document is made taller than the screen so the scroll is REAL.
    expect(document.documentElement.style.height).toBe('897px')
    await nextFrame()
    expect(scrollToSpy).toHaveBeenNthCalledWith(1, 0, 1)
    expect(scrollToSpy).toHaveBeenNthCalledWith(2, 0, 0)
    // The shell height override is removed after the jog.
    expect(document.documentElement.style.height).toBe('')
  })

  it('leaves a full-height viewport alone', async () => {
    mockStandalone(true)
    const vv = mockVisualViewport(896)
    installViewportScrollRestore()

    vv.fire('resize')
    await nextFrame()
    expect(scrollToSpy).not.toHaveBeenCalled()
    expect(document.documentElement.style.height).toBe('')
  })

  it('does not fight the keyboard while an input is focused', async () => {
    mockStandalone(true)
    const vv = mockVisualViewport(896)
    installViewportScrollRestore()

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    vv.height = 500 // keyboard open
    vv.fire('resize')
    await nextFrame()
    expect(scrollToSpy).not.toHaveBeenCalled()
    input.remove()
  })

  it('is inert outside standalone display mode (browser tabs)', async () => {
    mockStandalone(false)
    const vv = mockVisualViewport(700) // browsers are legitimately shorter
    installViewportScrollRestore()

    vv.fire('resize')
    await nextFrame()
    expect(scrollToSpy).not.toHaveBeenCalled()
  })
})
