// qr-scanner type definitions

declare module 'qr-scanner' {
  export interface ScanResult {
    data: string
    cornerPoints: { x: number; y: number }[]
  }

  export interface QrScannerOptions {
    returnDetailedScanResult?: boolean
    highlightScanRegion?: boolean
    highlightCodeOutline?: boolean
    preferredCamera?: 'environment' | 'user' | string
    maxScansPerSecond?: number
    onDecodeError?: (error: Error | string) => void
    overlay?: HTMLDivElement
    calculateScanRegion?: (video: HTMLVideoElement) => ScanRegion
  }

  export interface ScanRegion {
    x?: number
    y?: number
    width?: number
    height?: number
    downScaledWidth?: number
    downScaledHeight?: number
  }

  export default class QrScanner {
    $video: HTMLVideoElement

    constructor(
      video: HTMLVideoElement,
      onDecode: (result: ScanResult) => void,
      options?: QrScannerOptions
    )

    start(): Promise<void>
    stop(): void
    destroy(): void
    pause(stopStreamImmediately?: boolean): Promise<boolean>
    setCamera(camera: string): Promise<void>
    hasFlash(): Promise<boolean>
    isFlashOn(): boolean
    toggleFlash(): Promise<void>
    turnFlashOn(): Promise<void>
    turnFlashOff(): Promise<void>
    setInversionMode(mode: 'original' | 'invert' | 'both'): void
    setGrayscaleWeights(red: number, green: number, blue: number, useIntegerApproximation?: boolean): void

    static hasCamera(): Promise<boolean>
    static listCameras(requestLabels?: boolean): Promise<{ id: string; label: string }[]>
    static scanImage(
      image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | string | File | Blob | URL,
      options?: { scanRegion?: ScanRegion; qrEngine?: Worker; canvas?: HTMLCanvasElement; returnDetailedScanResult?: boolean }
    ): Promise<ScanResult>
  }
}
