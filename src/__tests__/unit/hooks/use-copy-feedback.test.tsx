import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const addToast = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}))

import { useCopyFeedback } from '@/ui/hooks/use-copy-feedback'

function stub(prop: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, prop, { configurable: true, value })
}

afterEach(() => {
  stub('share', undefined)
  stub('clipboard', undefined)
  Reflect.deleteProperty(document, 'execCommand')
  addToast.mockReset()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useCopyFeedback', () => {
  it('confirms a copy visually and with a toast, then clears the visual state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stub('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) })
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copy('payload')
    })

    expect(result.current.isCopied()).toBe(true)
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'toast.copied' }))

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.isCopied()).toBe(false)
  })

  // The reported iOS failure: navigator.share exists, so the old callback-based
  // helper returned before any feedback ran and the action looked like a no-op.
  it('confirms a native share with its own state and toast', async () => {
    stub('share', vi.fn().mockResolvedValue(undefined))
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.share('payload')
    })

    expect(result.current.isShared()).toBe(true)
    expect(result.current.isCopied()).toBe(false)
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'toast.shared' }))
  })

  // On a browser without Web Share the transport is the clipboard, but the
  // button the user pressed was Share — that is the one that must confirm.
  it('confirms the pressed Share button when the share falls back to the clipboard', async () => {
    stub('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) })
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await expect(result.current.share('payload')).resolves.toBe('copied')
    })

    expect(result.current.isShared()).toBe(true)
    expect(result.current.isCopied()).toBe(false)
    // The toast still tells the truth about what actually happened.
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'toast.copied' }))
  })

  it('schedules nothing when the clipboard settles after unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    stub('clipboard', { writeText: vi.fn().mockReturnValue(pending) })
    const { result, unmount } = renderHook(() => useCopyFeedback())

    let copying: Promise<boolean> | undefined
    act(() => {
      copying = result.current.copy('payload')
    })
    unmount()
    await act(async () => {
      release()
      await copying
    })

    // A reset timer here would mean a state update on an unmounted hook.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('says nothing when the user cancels the share sheet', async () => {
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' })
    stub('share', vi.fn().mockRejectedValue(abort))
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await expect(result.current.share('payload')).resolves.toBe('cancelled')
    })

    expect(result.current.isShared()).toBe(false)
    expect(addToast).not.toHaveBeenCalled()
  })

  it('keeps confirmations scoped to the field that was acted on', async () => {
    stub('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) })
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copy('payload', 'row-a')
    })

    expect(result.current.isCopied('row-a')).toBe(true)
    expect(result.current.isCopied('row-b')).toBe(false)
  })

  it('reports a failed copy as an error toast, not a success', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    // jsdom ships no execCommand; install a failing one so the legacy path runs.
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await expect(result.current.copy('payload')).resolves.toBe(false)
    })

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'toast.copyFailed' })),
    )
    expect(result.current.isCopied()).toBe(false)
  })
})
