import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEscapeDismiss } from '@/ui/hooks/use-escape-dismiss'

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

describe('useEscapeDismiss', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('dismisses the open dismissible', () => {
    const onDismiss = vi.fn()
    renderHook(() => useEscapeDismiss(true, onDismiss))

    pressEscape()

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  /**
   * The merge defect this exists for: a filter sheet opened inside the history
   * overlay closed both at once, because each attached its own document
   * listener and neither knew the other was there.
   */
  it('dismisses only the topmost when two are open', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    renderHook(() => useEscapeDismiss(true, closeOuter))
    renderHook(() => useEscapeDismiss(true, closeInner))

    pressEscape()

    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('hands control back to the one below once the top unmounts', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    renderHook(() => useEscapeDismiss(true, closeOuter))
    const inner = renderHook(() => useEscapeDismiss(true, closeInner))

    inner.unmount()
    pressEscape()

    expect(closeOuter).toHaveBeenCalledTimes(1)
    expect(closeInner).not.toHaveBeenCalled()
  })

  it('ignores a closed dismissible', () => {
    const onDismiss = vi.fn()
    renderHook(() => useEscapeDismiss(false, onDismiss))

    pressEscape()

    expect(onDismiss).not.toHaveBeenCalled()
  })

  /** A re-rendered callback must not promote this entry above the real top. */
  it('keeps stack order when the callback identity changes', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    const outer = renderHook(({ cb }) => useEscapeDismiss(true, cb), {
      initialProps: { cb: closeOuter },
    })
    renderHook(() => useEscapeDismiss(true, closeInner))

    outer.rerender({ cb: closeOuter })
    pressEscape()

    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('detaches the listener once nothing is open', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useEscapeDismiss(true, vi.fn()))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })
})
