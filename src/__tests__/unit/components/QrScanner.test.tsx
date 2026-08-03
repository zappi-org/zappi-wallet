import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { StrictMode } from 'react'
import type { ScanResult } from '@/ui/lib/qr-engine'
import type { QrPerformanceRecorder } from '@/ui/lib/qr-performance'

// Capture the scan callback passed to QrScannerLib constructor
let capturedScanCallback: ((result: ScanResult) => void) | null = null
let capturedScannerOptions: {
  preferredCamera?: string
  maxScansPerSecond?: number
  calculateScanRegion?: (video: HTMLVideoElement) => unknown
  calculateFastScanRegion?: (video: HTMLVideoElement) => unknown
  calculateRobustScanRegion?: (video: HTMLVideoElement) => unknown
  performanceRecorder?: QrPerformanceRecorder
} | null = null
let capturedScanner: {
  start: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} | null = null
let cameraAvailability: Promise<boolean> = Promise.resolve(true)
let scannerStartPromise: Promise<void> = Promise.resolve()
let scannerConstructionCount = 0
let videoGeometry: {
  videoWidth: number
  videoHeight: number
  clientWidth: number
  clientHeight: number
} | null = null

interface MockDecoder {
  receivePart: ReturnType<typeof vi.fn>
  estimatedPercentComplete: ReturnType<typeof vi.fn>
  isComplete: ReturnType<typeof vi.fn>
  isSuccess: ReturnType<typeof vi.fn>
  resultUR: ReturnType<typeof vi.fn>
}

let decoderInstances: MockDecoder[] = []

vi.mock('@/ui/lib/qr-engine', () => {
  class MockQrScanner {
    constructor(
      _video: HTMLVideoElement,
      onScan: (result: ScanResult) => void,
      options?: {
        preferredCamera?: string
        maxScansPerSecond?: number
        calculateScanRegion?: (video: HTMLVideoElement) => unknown
        calculateFastScanRegion?: (video: HTMLVideoElement) => unknown
        calculateRobustScanRegion?: (video: HTMLVideoElement) => unknown
        performanceRecorder?: QrPerformanceRecorder
      },
    ) {
      scannerConstructionCount += 1
      if (videoGeometry) {
        Object.defineProperties(_video, {
          videoWidth: { configurable: true, value: videoGeometry.videoWidth },
          videoHeight: { configurable: true, value: videoGeometry.videoHeight },
          clientWidth: { configurable: true, value: videoGeometry.clientWidth },
          clientHeight: { configurable: true, value: videoGeometry.clientHeight },
        })
        _video.dispatchEvent(new Event('loadedmetadata'))
      }
      capturedScanCallback = onScan
      capturedScannerOptions = options ?? null
      capturedScanner = {
        start: this.start,
        pause: this.pause,
        stop: this.stop,
      }
    }
    start = vi.fn(() => scannerStartPromise)
    pause = vi.fn().mockResolvedValue(true)
    stop = vi.fn()
    destroy = vi.fn()
    setInversionMode = vi.fn()
    static hasCamera = vi.fn(() => cameraAvailability)
  }
  class CameraPermissionError extends Error {}
  class CameraNotFoundError extends Error {}
  return {
    QrScanner: MockQrScanner,
    ManagedQrScanner: MockQrScanner,
    CameraPermissionError,
    CameraNotFoundError,
  }
})

vi.mock('@gandlaf21/bc-ur', () => ({
  URDecoder: vi.fn(function MockURDecoder() {
    const decoder: MockDecoder = {
      receivePart: vi.fn(),
      estimatedPercentComplete: vi.fn(() => 0.25),
      isComplete: vi.fn(() => false),
      isSuccess: vi.fn(() => false),
      resultUR: vi.fn(() => ({ decodeCBOR: () => Buffer.from('decoded-ur') })),
    }
    decoderInstances.push(decoder)
    return decoder
  }),
}))

// Stable reference to prevent useEffect re-runs from changing `t` identity
const stableT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}))

import { QrScanner } from '@/ui/components/common/QrScanner'

function scanResult(data: string): ScanResult {
  return { data } as ScanResult
}

describe('QrScanner deduplication', () => {
  let onScan: ReturnType<typeof vi.fn<(result: string) => void>>

  beforeEach(() => {
    cleanup()
    capturedScanCallback = null
    capturedScannerOptions = null
    capturedScanner = null
    cameraAvailability = Promise.resolve(true)
    scannerStartPromise = Promise.resolve()
    scannerConstructionCount = 0
    videoGeometry = null
    decoderInstances = []
    onScan = vi.fn()
  })

  async function renderScanner() {
    await act(async () => {
      render(<QrScanner onScan={onScan} active={true} />)
    })
    expect(capturedScanCallback).not.toBeNull()
  }

  it('should call onScan once for repeated identical data', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1test'))
    capturedScanCallback!(scanResult('lnbc1000n1test'))
    capturedScanCallback!(scanResult('lnbc1000n1test'))

    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith('lnbc1000n1test')
  })

  it('accepts the same static QR after validation pause and ignores a paused stale callback', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })

    capturedScanCallback!(scanResult('cashuA-static-token'))
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused />)
    })
    capturedScanCallback!(scanResult('cashuA-static-token'))
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused={false} />)
    })
    capturedScanCallback!(scanResult('cashuA-static-token'))
    capturedScanCallback!(scanResult('cashuA-static-token'))

    expect(onScan.mock.calls).toEqual([
      ['cashuA-static-token'],
      ['cashuA-static-token'],
    ])
  })

  it('scans the full-resolution guide square instead of the larger visible frame', async () => {
    videoGeometry = {
      videoWidth: 1920,
      videoHeight: 1080,
      clientWidth: 330,
      clientHeight: 412.5,
    }
    await renderScanner()
    const video = document.querySelector('video') as HTMLVideoElement

    expect(capturedScannerOptions).toMatchObject({
      preferredCamera: 'environment',
      maxScansPerSecond: 15,
      calculateScanRegion: expect.any(Function),
    })
    expect(capturedScannerOptions?.calculateScanRegion?.(video)).toEqual({
      x: 600,
      y: 180,
      width: 720,
      height: 720,
    })
    expect(capturedScannerOptions?.calculateFastScanRegion).toBeUndefined()
    expect(capturedScannerOptions?.calculateRobustScanRegion).toBeUndefined()
  })

  it('forwards each distinct animated UR fragment only once', async () => {
    await renderScanner()

    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
      capturedScanCallback!(scanResult('ur:bytes/2-3/bbb'))
    })

    expect(decoderInstances).toHaveLength(1)
    expect(decoderInstances[0].receivePart.mock.calls).toEqual([
      ['ur:bytes/1-3/aaa'],
      ['ur:bytes/2-3/bbb'],
    ])
  })

  it('marks a restarted active session before the existing UR fragment is deduplicated', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })
    const recorder = capturedScannerOptions!.performanceRecorder!
    const mark = vi.spyOn(recorder, 'mark')

    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active={false} />)
    })
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active />)
    })
    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })

    expect(mark.mock.calls).toEqual([
      ['first-ur-fragment'],
      ['first-ur-fragment'],
    ])
    expect(decoderInstances[0].receivePart).toHaveBeenCalledTimes(1)
  })

  it('marks the first UR callback again after pause and resume', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })
    const recorder = capturedScannerOptions!.performanceRecorder!
    const mark = vi.spyOn(recorder, 'mark')

    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused />)
    })
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused={false} />)
    })
    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })

    expect(mark.mock.calls).toEqual([
      ['first-ur-fragment'],
      ['first-ur-fragment'],
    ])
  })

  it('keeps a stale scanner callback from marking a replacement recorder', async () => {
    const first = render(<QrScanner onScan={onScan} active />)
    await act(async () => {
      await Promise.resolve()
    })
    const staleCallback = capturedScanCallback!

    await act(async () => {
      first.unmount()
    })
    await renderScanner()
    const replacementRecorder = capturedScannerOptions!.performanceRecorder!
    const replacementMark = vi.spyOn(replacementRecorder, 'mark')

    await act(async () => {
      staleCallback(scanResult('ur:bytes/1-3/stale'))
    })

    expect(replacementMark).not.toHaveBeenCalled()
  })

  it('accepts a previously seen UR fragment after pausing and resuming', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })

    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused />)
    })
    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused={false} />)
    })
    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })

    expect(decoderInstances[0].receivePart).toHaveBeenCalledTimes(2)
  })

  it('accepts a previously seen UR fragment after completion', async () => {
    await renderScanner()
    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-2/aaa'))
    })
    decoderInstances[0].isComplete.mockReturnValue(true)
    decoderInstances[0].isSuccess.mockReturnValue(true)

    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/2-2/bbb'))
      capturedScanCallback!(scanResult('ur:bytes/1-2/aaa'))
    })

    expect(onScan).toHaveBeenCalledWith('decoded-ur')
    expect(decoderInstances).toHaveLength(2)
    expect(decoderInstances[1].receivePart).toHaveBeenCalledWith('ur:bytes/1-2/aaa')
  })

  it('resets UR fragment tracking when unmounted', async () => {
    const first = render(<QrScanner onScan={onScan} active />)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })

    await act(async () => {
      first.unmount()
    })
    await renderScanner()
    await act(async () => {
      capturedScanCallback!(scanResult('ur:bytes/1-3/aaa'))
    })

    expect(decoderInstances).toHaveLength(2)
    expect(decoderInstances[1].receivePart).toHaveBeenCalledWith('ur:bytes/1-3/aaa')
  })

  it('renders centered square scan brackets without intercepting zoom gestures', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })

    const guide = view.getByTestId('qr-scan-guide')
    expect(guide).toHaveClass(
      'absolute',
      'aspect-square',
      'top-1/2',
      'left-1/2',
      '-translate-x-1/2',
      '-translate-y-1/2',
      'pointer-events-none',
    )
    expect(guide.children).toHaveLength(4)
  })

  it('matches the guide to the projected fast region for a landscape 4:5 preview', async () => {
    videoGeometry = {
      videoWidth: 1920,
      videoHeight: 1080,
      clientWidth: 330,
      clientHeight: 412.5,
    }
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })

    expect(view.getByTestId('qr-scan-guide')).toHaveStyle({ width: '275px' })
  })

  it('starts without waiting for a separate camera enumeration', async () => {
    cameraAvailability = new Promise<boolean>(() => {})

    await act(async () => {
      render(<QrScanner onScan={onScan} active={true} />)
    })

    expect(capturedScanCallback).not.toBeNull()
  })

  it('opens the camera only once during StrictMode effect replay', async () => {
    await act(async () => {
      render(
        <StrictMode>
          <QrScanner onScan={onScan} active={true} />
        </StrictMode>,
      )
    })

    expect(scannerConstructionCount).toBe(1)
  })

  it('pauses only decoding while paused and resumes without reconstructing the scanner', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })
    const scanner = capturedScanner!
    scanner.start.mockClear()

    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused />)
    })
    expect(scanner.pause).toHaveBeenCalledTimes(1)
    expect(scanner.stop).not.toHaveBeenCalled()

    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active paused={false} />)
    })
    expect(scanner.start).toHaveBeenCalledTimes(1)
    expect(scannerConstructionCount).toBe(1)
  })

  it('does not become ready when camera startup finishes after the scanner is deactivated', async () => {
    let resolveStart = () => {}
    scannerStartPromise = new Promise<void>((resolve) => { resolveStart = resolve })
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<QrScanner onScan={onScan} active />)
    })

    await act(async () => {
      view.rerender(<QrScanner onScan={onScan} active={false} />)
      await Promise.resolve()
    })
    await act(async () => {
      resolveStart()
      await scannerStartPromise
    })

    expect(view.getByText('scanner.cameraPreparing')).toBeInTheDocument()
  })

  it('should call onScan again when data changes', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1first'))
    capturedScanCallback!(scanResult('lnbc1000n1second'))

    expect(onScan).toHaveBeenCalledTimes(2)
    expect(onScan).toHaveBeenNthCalledWith(1, 'lnbc1000n1first')
    expect(onScan).toHaveBeenNthCalledWith(2, 'lnbc1000n1second')
  })

  it('should allow same data after a different QR is scanned', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('qr-a'))
    capturedScanCallback!(scanResult('qr-b'))
    capturedScanCallback!(scanResult('qr-a'))

    expect(onScan).toHaveBeenCalledTimes(3)
  })

  it('should ignore empty scan results', async () => {
    await renderScanner()

    capturedScanCallback!({ data: '' } as ScanResult)
    capturedScanCallback!(null as unknown as ScanResult)
    capturedScanCallback!({ data: undefined } as unknown as ScanResult)

    expect(onScan).not.toHaveBeenCalled()
  })

  it('should reset dedup state on remount', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1test'))
    expect(onScan).toHaveBeenCalledTimes(1)

    // Unmount and remount
    await act(async () => {
      cleanup()
    })
    capturedScanCallback = null
    onScan.mockClear()

    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1test'))
    expect(onScan).toHaveBeenCalledTimes(1)
  })
})
