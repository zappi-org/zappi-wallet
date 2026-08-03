import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  configureWasm: vi.fn(),
  configuredWorkerUrl: null as string | null,
  setWorkerUrl: vi.fn((url: string) => {
    mocks.configuredWorkerUrl = url
  }),
  scanImage: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(true),
  stop: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@agicash/qr-scanner', () => {
  class CashuQrScanner {
    static configureWasm = mocks.configureWasm
    static setWorkerUrl = mocks.setWorkerUrl
    static scanImage = mocks.scanImage

    constructor(...args: unknown[]) {
      mocks.constructor(...args)
    }

    start = mocks.start
    pause = mocks.pause
    stop = mocks.stop
    destroy = mocks.destroy
  }

  return {
    default: CashuQrScanner,
    CameraNotFoundError: class CameraNotFoundError extends Error {},
    CameraPermissionError: class CameraPermissionError extends Error {},
  }
})

vi.mock('zxing-wasm/reader/zxing_reader.wasm?url', () => ({
  default: '/assets/zxing_reader-test.wasm',
}))

vi.mock('@/ui/lib/cashu-qr.worker.ts?worker&url', () => ({
  default: '/assets/cashu-qr-worker-test.js',
}))

const { ManagedQrScanner, scanImageFile } = await import('@/ui/lib/qr-engine')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Cashu-compatible QR engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.start.mockResolvedValue(undefined)
    mocks.pause.mockResolvedValue(true)
  })

  it('uses the Cashu WASM scanner as the single live camera decoder', () => {
    const video = document.createElement('video')
    const onDecode = vi.fn()
    const calculateRegion = vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 }))

    new ManagedQrScanner(video, onDecode, {
      preferredCamera: 'environment',
      maxScansPerSecond: 15,
      calculateRobustScanRegion: calculateRegion,
    })

    expect(mocks.constructor).toHaveBeenCalledWith(
      video,
      onDecode,
      expect.objectContaining({
        preferredCamera: 'environment',
        maxScansPerSecond: 15,
        calculateScanRegion: calculateRegion,
        decoderOptions: expect.objectContaining({ tryHarder: true, tryInvert: true }),
      }),
    )
    expect(mocks.configuredWorkerUrl).toBe('/assets/cashu-qr-worker-test.js')
  })

  it('keeps the camera stream while validation pauses decoding', async () => {
    const scanner = new ManagedQrScanner(document.createElement('video'), vi.fn())

    await scanner.start()
    await scanner.pause()

    expect(mocks.pause).toHaveBeenCalledWith(false)
  })

  it('waits for an in-flight camera start before destroying the package scanner', async () => {
    const starting = deferred<void>()
    mocks.start.mockReturnValueOnce(starting.promise)
    const scanner = new ManagedQrScanner(document.createElement('video'), vi.fn())

    const start = scanner.start()
    const destroy = scanner.destroy()

    expect(mocks.destroy).not.toHaveBeenCalled()
    starting.resolve(undefined)
    await Promise.allSettled([start, destroy])

    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('decodes imported photos through the same local Cashu worker', async () => {
    const posted: unknown[] = []
    const workers: Array<{
      onmessage: ((event: MessageEvent) => void) | null
      onerror: ((event: ErrorEvent) => void) | null
      terminate: ReturnType<typeof vi.fn>
    }> = []

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      onmessageerror: (() => void) | null = null
      terminate = vi.fn()

      constructor(url: string | URL, options?: WorkerOptions) {
        expect(String(url)).toBe('/assets/cashu-qr-worker-test.js')
        expect(options).toEqual({ type: 'module' })
        workers.push(this)
      }

      postMessage(message: unknown) {
        posted.push(message)
      }
    }

    vi.stubGlobal('Worker', MockWorker)
    const file = new Blob(['qr'], { type: 'image/png' })
    const result = scanImageFile(file)
    const worker = workers[0]

    expect(posted).toEqual([
      { type: 'configure', options: expect.objectContaining({ tryHarder: true }) },
      { type: 'decode', imageData: file },
    ])

    worker.onmessage?.({
      data: {
        type: 'result',
        results: [{ data: 'cashuA-photo-result', cornerPoints: [] }],
      },
    } as MessageEvent)

    await expect(result).resolves.toBe('cashuA-photo-result')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(mocks.scanImage).not.toHaveBeenCalled()
  })
})
