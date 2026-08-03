import { describe, expect, it, vi } from 'vitest'
import { createQrPerformanceRecorder } from '@/ui/lib/qr-performance'

function sequence(...values: number[]): () => number {
  let index = 0
  return () => values[index++]!
}

describe('createQrPerformanceRecorder', () => {
  it('reports an enabled stage with elapsed time from its construction baseline', () => {
    const sink = vi.fn()
    const recorder = createQrPerformanceRecorder({
      enabled: true,
      now: sequence(10, 35),
      sink,
    })

    recorder.mark('camera-playing')

    expect(sink).toHaveBeenCalledWith('camera-playing', 25)
  })

  it('does not report stages when disabled', () => {
    const sink = vi.fn()
    const now = vi.fn(sequence(10, 35))
    const recorder = createQrPerformanceRecorder({
      enabled: false,
      now,
      sink,
    })

    recorder.mark('camera-playing')

    expect(sink).not.toHaveBeenCalled()
    expect(now).toHaveBeenCalledTimes(1)
  })
})
