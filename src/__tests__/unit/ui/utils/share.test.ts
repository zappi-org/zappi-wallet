import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareOrCopyText, writeClipboardText } from '@/ui/utils/share'

function stub(prop: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, prop, { configurable: true, value })
}

// jsdom ships no execCommand, so the legacy path has to be installed to be exercised.
function stubExecCommand(result: boolean) {
  const fn = vi.fn().mockReturnValue(result)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fn })
  return fn
}

afterEach(() => {
  stub('share', undefined)
  stub('clipboard', undefined)
  Reflect.deleteProperty(document, 'execCommand')
  vi.restoreAllMocks()
})

describe('shareOrCopyText outcomes', () => {
  // The bug this API exists for: on iOS the native sheet always exists, so a
  // void-returning helper left every caller unable to confirm anything.
  it('reports "shared" when the native sheet accepts it, without touching the clipboard', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('share', share)
    stub('clipboard', { writeText })

    await expect(shareOrCopyText('payload')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ text: 'payload' })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('reports "cancelled" on AbortError and does not fall back to the clipboard', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('share', vi.fn().mockRejectedValue(abort))
    stub('clipboard', { writeText })

    await expect(shareOrCopyText('payload')).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard and reports "copied" when the sheet fails for any other reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('share', vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    stub('clipboard', { writeText })

    await expect(shareOrCopyText('payload')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('payload')
  })

  it('reports "copied" when there is no share sheet at all', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stub('clipboard', { writeText })

    await expect(shareOrCopyText('payload')).resolves.toBe('copied')
  })

  it('reports "failed" when neither channel works', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    stubExecCommand(false)

    await expect(shareOrCopyText('payload')).resolves.toBe('failed')
  })
})

describe('writeClipboardText', () => {
  it('uses the execCommand path when the async Clipboard API rejects', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('insecure context')) })
    const exec = stubExecCommand(true)

    await expect(writeClipboardText('payload')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    // The scratch textarea must not survive the copy.
    expect(document.querySelector('textarea')).toBeNull()
  })

  // A selected, invisible textarea left in the DOM steals focus, and every
  // retry adds another one.
  it('removes the scratch textarea when execCommand is missing', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('insecure context')) })

    await expect(writeClipboardText('payload')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('removes the scratch textarea when execCommand throws', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('insecure context')) })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('blocked by policy')
      },
    })

    await expect(writeClipboardText('payload')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })
})
