import CashuQrScanner, {
  CameraNotFoundError,
  CameraPermissionError,
  type ScanRegion,
  type ScanResult,
} from '@agicash/qr-scanner'
import type { ReaderOptions } from 'zxing-wasm/reader'
import cashuQrWorkerUrl from './cashu-qr.worker.ts?worker&url'
import type { QrPerformanceRecorder } from './qr-performance'
import type { FastScanRegion } from './qr-scan-region'

export type { ScanRegion, ScanResult }
export { CameraNotFoundError, CameraPermissionError }

/** Cashu-compatible QR-only ZXing options. */
export const DECODER_OPTIONS: Partial<ReaderOptions> = {
  formats: ['QRCode'],
  tryHarder: true,
  tryInvert: true,
  tryRotate: true,
  tryDenoise: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
}

// Use the bundled worker for offline scanning.
CashuQrScanner.setWorkerUrl(cashuQrWorkerUrl)

interface WorkerResponse {
  type: 'ready' | 'result' | 'error'
  results?: ScanResult[]
  message?: string
}

const PHOTO_DECODE_TIMEOUT_MS = 20_000

export function scanImageFile(file: Blob): Promise<string> {
  const worker = new Worker(cashuQrWorkerUrl, { type: 'module' })

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      fail(new Error('QR image decode timed out'))
    }, PHOTO_DECODE_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    const finish = (value: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      if (response.type === 'ready') return
      if (response.type === 'error') {
        fail(new Error(response.message ?? 'QR image decode failed'))
        return
      }

      const result = response.results?.[0]
      if (result) finish(result.data)
      else fail(new Error('No QR code found in the image'))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fail(new Error(event.message || 'QR image decoder worker failed'))
    }
    worker.onmessageerror = () => {
      fail(new Error('QR image decoder worker sent an unreadable reply'))
    }

    worker.postMessage({ type: 'configure', options: DECODER_OPTIONS })
    worker.postMessage({ type: 'decode', imageData: file })
  })
}

export interface ManagedQrScannerOptions {
  onDecodeError?: (error: Error | string) => void
  calculateScanRegion?: (video: HTMLVideoElement) => ScanRegion
  calculateFastScanRegion?: (video: HTMLVideoElement) => FastScanRegion
  calculateRobustScanRegion?: (video: HTMLVideoElement) => ScanRegion
  preferredCamera?: string
  maxScansPerSecond?: number
  highlightScanRegion?: boolean
  highlightCodeOutline?: boolean
  overlay?: HTMLDivElement
  cameraResolution?: {
    width?: MediaTrackConstraintSet['width']
    height?: MediaTrackConstraintSet['height']
  }
  performanceRecorder?: QrPerformanceRecorder
}

/** Owns one camera stream across active, paused, and stopped states. */
export class ManagedQrScanner {
  private readonly scanner: CashuQrScanner
  private started = false
  private destroyed = false
  private desiredState: 'active' | 'paused' | 'stopped' | 'destroyed' = 'stopped'
  private pendingStart: Promise<void> | null = null
  private destroyPromise: Promise<void> | null = null

  constructor(
    video: HTMLVideoElement,
    onDecode: (result: ScanResult) => void,
    options: ManagedQrScannerOptions = {},
  ) {
    const calculateScanRegion = options.calculateRobustScanRegion
      ?? options.calculateScanRegion
      ?? ((currentVideo: HTMLVideoElement) => ({
        x: 0,
        y: 0,
        width: currentVideo.videoWidth,
        height: currentVideo.videoHeight,
      }))

    this.scanner = new CashuQrScanner(video, onDecode, {
      onDecodeError: options.onDecodeError,
      calculateScanRegion,
      preferredCamera: options.preferredCamera,
      maxScansPerSecond: options.maxScansPerSecond ?? 15,
      highlightScanRegion: options.highlightScanRegion,
      highlightCodeOutline: options.highlightCodeOutline,
      overlay: options.overlay,
      cameraResolution: options.cameraResolution,
      decoderOptions: DECODER_OPTIONS,
    })
  }

  async start(): Promise<void> {
    if (this.destroyed) throw new Error('Scanner has been destroyed')
    this.desiredState = 'active'
    if (this.pendingStart) return this.pendingStart

    const pending = this.scanner.start().then(() => {
      this.started = true
      if (this.desiredState === 'stopped') {
        this.started = false
        this.scanner.stop()
      }
    })
    this.pendingStart = pending
    void pending.finally(() => {
      if (this.pendingStart === pending) this.pendingStart = null
    }).catch(() => {})
    return pending
  }

  stop(): void {
    if (this.destroyed) return
    this.desiredState = 'stopped'
    this.started = false
    if (this.pendingStart) return
    this.scanner.stop()
  }

  /** Pauses decoding while retaining the preview. */
  async pause(): Promise<boolean> {
    if (this.destroyed) return false
    this.desiredState = 'paused'
    if (this.pendingStart) await this.pendingStart
    if (this.destroyed || this.desiredState !== 'paused' || !this.started) return false
    return this.scanner.pause(false)
  }

  async destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise
    this.destroyed = true
    this.desiredState = 'destroyed'
    this.started = false
    const pendingStart = this.pendingStart
    this.destroyPromise = (pendingStart
      ? pendingStart.catch(() => {})
      : Promise.resolve()
    ).then(() => {
      this.scanner.destroy()
    })
    return this.destroyPromise
  }
}

export { CashuQrScanner as QrScanner }
