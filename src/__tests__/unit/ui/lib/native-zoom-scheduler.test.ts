import { describe, expect, it, vi } from 'vitest'
import { NativeZoomScheduler } from '@/ui/lib/native-zoom-scheduler'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function trackWith(applyConstraints: ReturnType<typeof vi.fn>): MediaStreamTrack {
  return { applyConstraints } as unknown as MediaStreamTrack
}

describe('NativeZoomScheduler', () => {
  it('snaps zoom requests to the camera capability step', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined)
    const track = trackWith(applyConstraints)
    const scheduler = new NativeZoomScheduler()

    scheduler.request(track, 1.24, { min: 1, max: 4, step: 0.1 })

    await vi.waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(1))
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.2 }] })
  })

  it('does not reapply the same camera zoom step', async () => {
    const first = deferred<void>()
    const applyConstraints = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const track = trackWith(applyConstraints)
    const scheduler = new NativeZoomScheduler()
    const range = { min: 1, max: 4, step: 0.1 }

    scheduler.request(track, 1.24, range)
    scheduler.request(track, 1.22, range)
    first.resolve()
    await first.promise
    await Promise.resolve()

    expect(applyConstraints).toHaveBeenCalledTimes(1)
  })

  it('applies only the newest zoom requested while the camera is busy', async () => {
    const first = deferred<void>()
    const applyConstraints = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const track = trackWith(applyConstraints)
    const scheduler = new NativeZoomScheduler()

    scheduler.request(track, 1.25)
    scheduler.request(track, 2)
    scheduler.request(track, 3.5)

    expect(applyConstraints).toHaveBeenCalledTimes(1)
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.25 }] })

    first.resolve()
    await vi.waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(2))
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3.5 }] })
  })

  it('continues with the newest zoom after a camera constraint rejection', async () => {
    const first = deferred<void>()
    const applyConstraints = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const track = trackWith(applyConstraints)
    const scheduler = new NativeZoomScheduler()

    scheduler.request(track, 1.5)
    scheduler.request(track, 2.5)
    first.reject(new DOMException('Camera is busy', 'AbortError'))

    await vi.waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(2))
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 2.5 }] })
  })

  it('drops queued zoom work when the scanner is reset', async () => {
    const first = deferred<void>()
    const applyConstraints = vi.fn().mockReturnValue(first.promise)
    const track = trackWith(applyConstraints)
    const scheduler = new NativeZoomScheduler()

    scheduler.request(track, 1.5)
    scheduler.request(track, 4)
    scheduler.reset()
    first.resolve()
    await first.promise
    await Promise.resolve()

    expect(applyConstraints).toHaveBeenCalledTimes(1)
  })
})
