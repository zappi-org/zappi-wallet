import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import QrScannerLib from 'qr-scanner'
type ScanResult = QrScannerLib.ScanResult
import { URDecoder } from '@gandlaf21/bc-ur'
import { Image } from 'lucide-react'
import { usePinchZoom } from '@/hooks/use-pinch-zoom'

export interface QrScannerProps {
  onScan: (result: string) => void
  onError?: (error: string) => void
  active?: boolean
}

export function QrScanner({ onScan, onError, active = true }: QrScannerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScannerLib | null>(null)
  const urDecoderRef = useRef<URDecoder | null>(null)
  const lastScannedDataRef = useRef<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [hasCamera, setHasCamera] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [urProgress, setUrProgress] = useState(0)

  // Pinch-to-zoom
  const { zoomLevel, videoStyle, getScanRegion } = usePinchZoom({
    containerRef,
    scannerRef,
    enabled: active && isReady,
  })
  const getScanRegionRef = useRef(getScanRegion)

  // Stable callback refs
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onScanRef.current = onScan
    onErrorRef.current = onError
    getScanRegionRef.current = getScanRegion
  }, [onScan, onError, getScanRegion])

  const handleScan = useCallback((result: ScanResult) => {
    if (!result?.data) return

    const data = result.data

    // Check if this is a UR (animated/multipart) QR code
    if (data.toLowerCase().startsWith('ur:')) {
      // Initialize decoder if needed
      if (!urDecoderRef.current) {
        urDecoderRef.current = new URDecoder()
      }

      const decoder = urDecoderRef.current
      decoder.receivePart(data)
      setUrProgress(decoder.estimatedPercentComplete() || 0)

      // Check if complete
      if (decoder.isComplete() && decoder.isSuccess()) {
        const ur = decoder.resultUR()
        const decoded = ur.decodeCBOR()
        lastScannedDataRef.current = decoded.toString()
        onScanRef.current(decoded.toString())
        // Reset decoder for next scan
        urDecoderRef.current = null
        setUrProgress(0)
      }
    } else {
      // Skip if same data as last scan
      if (data === lastScannedDataRef.current) return
      lastScannedDataRef.current = data
      onScanRef.current(data)
    }
  }, [])

  // Image upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState('')
  const imageErrorTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input so same file can be selected again
    e.target.value = ''
    setImageError('')
    if (imageErrorTimer.current) clearTimeout(imageErrorTimer.current)

    try {
      const result = await QrScannerLib.scanImage(file, { returnDetailedScanResult: true })
      if (result?.data) {
        onScanRef.current(result.data)
      }
    } catch {
      setImageError(t('scanner.noQrFound'))
      imageErrorTimer.current = setTimeout(() => setImageError(''), 3000)
    }
  }, [t])

  // Initialize and cleanup scanner
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let mounted = true

    const initScanner = async () => {
      // Check camera availability
      const cameraAvailable = await QrScannerLib.hasCamera()
      if (!mounted) return

      if (!cameraAvailable) {
        setHasCamera(false)
        setErrorMessage(t('scanner.cameraNotFound'))
        onErrorRef.current?.(t('scanner.cameraNotFound'))
        return
      }

      // Create scanner instance
      const scanner = new QrScannerLib(
        video,
        handleScan,
        {
          returnDetailedScanResult: true,
          highlightScanRegion: false,
          highlightCodeOutline: false,
          onDecodeError: () => {},
          preferredCamera: 'environment',
          maxScansPerSecond: 10,
          calculateScanRegion: (v) => getScanRegionRef.current(v),
        }
      )

      // Enable both normal and inverted QR code recognition
      scanner.setInversionMode('both')

      scannerRef.current = scanner

      if (active) {
        try {
          await scanner.start()
          if (mounted) {
            setIsReady(true)
            setErrorMessage('')
          }
        } catch (err) {
          if (!mounted) return
          console.error('[QrScanner] Failed to start:', err)

          const error = err as Error
          if (error?.name === 'NotAllowedError') {
            setErrorMessage(t('scanner.cameraPermission'))
            onErrorRef.current?.(t('scanner.cameraPermission'))
          } else if (error?.name === 'NotFoundError') {
            setHasCamera(false)
            setErrorMessage(t('scanner.cameraNotFound'))
            onErrorRef.current?.(t('scanner.cameraNotFound'))
          } else {
            setErrorMessage(t('scanner.cameraStartFailed'))
            onErrorRef.current?.(t('scanner.cameraStartFailed'))
          }
        }
      }
    }

    initScanner()

    return () => {
      mounted = false
      if (scannerRef.current) {
        scannerRef.current.destroy()
        scannerRef.current = null
      }
      urDecoderRef.current = null
      lastScannedDataRef.current = null
      if (imageErrorTimer.current) clearTimeout(imageErrorTimer.current)
      setUrProgress(0)
      setIsReady(false)
    }
  }, [handleScan, active, t])

  // Handle active state changes
  useEffect(() => {
    const scanner = scannerRef.current
    if (!scanner) return

    if (active) {
      scanner.start()
        .then(() => {
          setIsReady(true)
          setErrorMessage('')
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') {
            console.error('[QrScanner] Start error:', err)
          }
        })
    } else {
      scanner.stop()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on active toggle
      setIsReady(false)
    }
  }, [active])

  if (!hasCamera) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-muted rounded-xl">
        <div className="w-16 h-16 bg-destructive/20 rounded-full flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
            <path d="m2 2 20 20" />
            <path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
            <path d="M15 15v2" />
            <path d="M21.83 14.83A2 2 0 0 0 22 14V9a2 2 0 0 0-2-2h-9" />
          </svg>
        </div>
        <p className="text-foreground-muted text-center">{t('scanner.cameraNotFound')}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-[14px] bg-black">
      <video
        ref={videoRef}
        className="w-full aspect-square object-cover"
        style={videoStyle}
        playsInline
        muted
      />

      {/* Zoom indicator */}
      {zoomLevel > 1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm pointer-events-none z-10">
          <span className="text-white text-label font-medium">{zoomLevel.toFixed(1)}x</span>
        </div>
      )}

      {/* Image upload — bottom right */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="absolute bottom-3 right-3 p-1.5 rounded-[10px] bg-black/50 backdrop-blur-sm active:bg-black/70 transition-colors z-10"
        aria-label={t('scanner.uploadImage')}
      >
        <Image className="w-6 h-6 text-white" strokeWidth={1.8} />
      </button>

      {/* Image scan error toast */}
      {imageError && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/70 backdrop-blur-sm z-10">
          <span className="text-white text-caption font-medium">{imageError}</span>
        </div>
      )}

      {/* Loading overlay */}
      {!isReady && !errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <div className="w-10 h-10 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-white/70 text-caption">{t('scanner.cameraPreparing')}</p>
        </div>
      )}

      {/* UR Progress indicator for animated QR codes */}
      {urProgress > 0 && (
        <div className="absolute bottom-4 left-4 right-4">
          <div className="bg-black/70 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/90 text-label font-medium">{t('scanner.multipartScanning')}</span>
              <span className="text-accent-primary text-label font-bold">{Math.round(urProgress * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-primary rounded-full transition-all duration-200"
                style={{ width: `${urProgress * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center p-4">
            <p className="text-destructive mb-2">{errorMessage}</p>
            <p className="text-caption text-foreground-muted">
              {t('scanner.enableCameraPermission')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
