import { useRef, useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react'
import {
  calculateFastScanGuideSize,
  calculateFastScanRegion,
  type FastScanRegion,
  type ScanRegion,
} from '@/ui/lib/qr-scan-region'
import {
  NativeZoomScheduler,
  type NativeZoomRange,
} from '@/ui/lib/native-zoom-scheduler'

export { calculateVisibleScanRegion } from '@/ui/lib/qr-scan-region'

export interface UsePinchZoomOptions {
  containerRef: RefObject<HTMLElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  enabled: boolean
  minZoom?: number
  maxZoom?: number
}

export interface UsePinchZoomReturn {
  zoomLevel: number
  videoStyle: CSSProperties
  scanGuideStyle: CSSProperties
  getGuideScanRegion: (video: HTMLVideoElement) => ScanRegion
}

/** Distance between two touch points */
function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Pinch-to-zoom hook for QR scanner.
 *
 * Platform strategy:
 * - Android: native camera zoom via `applyConstraints({ advanced: [{ zoom }] })`
 * - iOS/fallback: direct DOM transform for real-time visual zoom + scan region crop for decoder zoom
 */
export function usePinchZoom({
  containerRef,
  videoRef,
  enabled,
  minZoom = 1,
  maxZoom = 5,
}: UsePinchZoomOptions): UsePinchZoomReturn {
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isNativeZoom, setIsNativeZoom] = useState(false)
  const [scanGuideSize, setScanGuideSize] = useState(0)
  const zoomRef = useRef(1)

  // Platform capability detection (refs for event handler access)
  const isNativeZoomRef = useRef(false)
  const nativeZoomRange = useRef<NativeZoomRange>({ min: 1, max: 1 })
  const capabilitiesChecked = useRef(false)
  const nativeZoomScheduler = useRef(new NativeZoomScheduler())

  // Pinch gesture state
  const initialDistance = useRef(0)
  const initialZoom = useRef(1)
  const isPinching = useRef(false)
  const rafId = useRef(0)

  // Check native zoom support once scanner is active
  const checkCapabilities = useCallback(() => {
    if (capabilitiesChecked.current) return
    const video = videoRef.current
    if (!video) return

    try {
      const stream = video.srcObject
      if (!(stream instanceof MediaStream)) return

      const track = stream.getVideoTracks()[0]
      if (!track) return

      const capabilities = track.getCapabilities?.() as Record<string, unknown> | undefined
      if (capabilities?.zoom) {
        const zoomCap = capabilities.zoom as NativeZoomRange
        isNativeZoomRef.current = true
        setIsNativeZoom(true)
        nativeZoomRange.current = {
          min: zoomCap.min,
          max: zoomCap.max,
          step: zoomCap.step,
        }
      }
      capabilitiesChecked.current = true
    } catch {
      // Capabilities not available yet — will retry on next pinch
    }
  }, [videoRef])

  // Apply zoom — direct DOM manipulation for real-time feedback
  const applyZoomImmediate = useCallback((level: number) => {
    const clamped = Math.max(minZoom, Math.min(maxZoom, level))
    zoomRef.current = clamped

    const video = videoRef.current
    if (!video) return

    if (isNativeZoomRef.current) {
      // Android: native camera zoom
      const stream = video.srcObject
      if (!(stream instanceof MediaStream)) return
      const track = stream.getVideoTracks()[0]
      if (!track) return
      const range = nativeZoomRange.current
      const { min, max } = range
      const nativeZoom = min + ((clamped - minZoom) / (maxZoom - minZoom)) * (max - min)
      nativeZoomScheduler.current.request(track, nativeZoom, range)
    } else {
      // iOS: direct DOM transform for instant visual feedback
      if (clamped > 1) {
        video.style.transform = `scale(${clamped})`
        video.style.transformOrigin = 'center center'
      } else {
        video.style.transform = ''
        video.style.transformOrigin = ''
      }
    }
  }, [videoRef, minZoom, maxZoom])

  const updateScanGuideSize = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextSize = calculateFastScanGuideSize(
      video.videoWidth,
      video.videoHeight,
      video.clientWidth,
      video.clientHeight,
      zoomRef.current,
      isNativeZoomRef.current,
    )
    if (nextSize <= 0) return
    setScanGuideSize((current) => current === nextSize ? current : nextSize)
  }, [videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const initialFrame = requestAnimationFrame(updateScanGuideSize)
    video.addEventListener('loadedmetadata', updateScanGuideSize)
    video.addEventListener('resize', updateScanGuideSize)
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateScanGuideSize)
      : null
    resizeObserver?.observe(video)

    return () => {
      cancelAnimationFrame(initialFrame)
      video.removeEventListener('loadedmetadata', updateScanGuideSize)
      video.removeEventListener('resize', updateScanGuideSize)
      resizeObserver?.disconnect()
    }
  }, [videoRef, updateScanGuideSize])

  // Touch event handlers
  useEffect(() => {
    if (!enabled) return

    const container = containerRef.current
    if (!container) return
    const zoomScheduler = nativeZoomScheduler.current

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return

      checkCapabilities()
      isPinching.current = true
      initialDistance.current = getTouchDistance(e.touches[0], e.touches[1])
      initialZoom.current = zoomRef.current
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isPinching.current || e.touches.length < 2) return

      // Prevent scroll/default behavior during pinch
      e.preventDefault()

      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const currentDistance = getTouchDistance(e.touches[0], e.touches[1])
        const scale = currentDistance / initialDistance.current
        const newZoom = initialZoom.current * scale
        applyZoomImmediate(newZoom)
      })
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinching.current = false
        // Sync React state after gesture ends (for zoom indicator + scan region)
        setZoomLevel(zoomRef.current)
        updateScanGuideSize()
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      cancelAnimationFrame(rafId.current)
      zoomScheduler.reset()
    }
  }, [enabled, containerRef, checkCapabilities, applyZoomImmediate, updateScanGuideSize])

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      zoomRef.current = 1
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on prop change
      setZoomLevel(1)
      capabilitiesChecked.current = false
      isNativeZoomRef.current = false
      setIsNativeZoom(false)
      nativeZoomScheduler.current.reset()

      // Reset DOM transform
      const video = videoRef.current
      if (video) {
        video.style.transform = ''
        video.style.transformOrigin = ''
      }
    }
  }, [enabled, videoRef])

  // CSS transform for initial render / non-gesture state
  // During gestures, DOM is manipulated directly for real-time feedback
  const videoStyle: CSSProperties = isNativeZoom
    ? {}
    : zoomLevel > 1
      ? { transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }
      : {}
  const scanGuideStyle: CSSProperties = {
    width: scanGuideSize > 0 ? scanGuideSize : '66.666667%',
  }

  // Decode the visible guide at source resolution.
  const getGuideScanRegion = useCallback((video: HTMLVideoElement): ScanRegion => {
    const region: FastScanRegion = calculateFastScanRegion(
      video.videoWidth,
      video.videoHeight,
      video.clientWidth,
      video.clientHeight,
      zoomRef.current,
      isNativeZoomRef.current,
    )
    return {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    }
  }, [])

  return {
    zoomLevel,
    videoStyle,
    scanGuideStyle,
    getGuideScanRegion,
  }
}
