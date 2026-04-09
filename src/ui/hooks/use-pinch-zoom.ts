import { useRef, useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react'
import type QrScannerLib from 'qr-scanner'
type ScanRegion = QrScannerLib.ScanRegion

export interface UsePinchZoomOptions {
  containerRef: RefObject<HTMLElement | null>
  scannerRef: RefObject<QrScannerLib | null>
  enabled: boolean
  minZoom?: number
  maxZoom?: number
}

export interface UsePinchZoomReturn {
  zoomLevel: number
  videoStyle: CSSProperties
  getScanRegion: (video: HTMLVideoElement) => ScanRegion
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
  scannerRef,
  enabled,
  minZoom = 1,
  maxZoom = 5,
}: UsePinchZoomOptions): UsePinchZoomReturn {
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isNativeZoom, setIsNativeZoom] = useState(false)
  const zoomRef = useRef(1)

  // Platform capability detection (refs for event handler access)
  const isNativeZoomRef = useRef(false)
  const nativeZoomRange = useRef({ min: 1, max: 1 })
  const capabilitiesChecked = useRef(false)

  // Pinch gesture state
  const initialDistance = useRef(0)
  const initialZoom = useRef(1)
  const isPinching = useRef(false)
  const rafId = useRef(0)

  // Check native zoom support once scanner is active
  const checkCapabilities = useCallback(() => {
    if (capabilitiesChecked.current) return
    const scanner = scannerRef.current
    if (!scanner) return

    try {
      const stream = scanner.$video.srcObject
      if (!(stream instanceof MediaStream)) return

      const track = stream.getVideoTracks()[0]
      if (!track) return

      const capabilities = track.getCapabilities?.() as Record<string, unknown> | undefined
      if (capabilities?.zoom) {
        const zoomCap = capabilities.zoom as { min: number; max: number }
        isNativeZoomRef.current = true
        setIsNativeZoom(true)
        nativeZoomRange.current = { min: zoomCap.min, max: zoomCap.max }
      }
      capabilitiesChecked.current = true
    } catch {
      // Capabilities not available yet — will retry on next pinch
    }
  }, [scannerRef])

  // Apply zoom — direct DOM manipulation for real-time feedback
  const applyZoomImmediate = useCallback((level: number) => {
    const clamped = Math.max(minZoom, Math.min(maxZoom, level))
    zoomRef.current = clamped

    const scanner = scannerRef.current
    if (!scanner) return

    if (isNativeZoomRef.current) {
      // Android: native camera zoom
      try {
        const stream = scanner.$video.srcObject
        if (!(stream instanceof MediaStream)) return
        const track = stream.getVideoTracks()[0]
        if (!track) return
        const { min, max } = nativeZoomRange.current
        const nativeZoom = min + ((clamped - minZoom) / (maxZoom - minZoom)) * (max - min)
        track.applyConstraints({ advanced: [{ zoom: nativeZoom } as MediaTrackConstraintSet] })
      } catch {
        // ignore
      }
    } else {
      // iOS: direct DOM transform for instant visual feedback
      const video = scanner.$video
      if (clamped > 1) {
        video.style.transform = `scale(${clamped})`
        video.style.transformOrigin = 'center center'
      } else {
        video.style.transform = ''
        video.style.transformOrigin = ''
      }
    }
  }, [scannerRef, minZoom, maxZoom])

  // Touch event handlers
  useEffect(() => {
    if (!enabled) return

    const container = containerRef.current
    if (!container) return

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
    }
  }, [enabled, containerRef, checkCapabilities, applyZoomImmediate])

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      zoomRef.current = 1
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on prop change
      setZoomLevel(1)
      capabilitiesChecked.current = false
      isNativeZoomRef.current = false
      setIsNativeZoom(false)

      // Reset DOM transform
      const scanner = scannerRef.current
      if (scanner) {
        scanner.$video.style.transform = ''
        scanner.$video.style.transformOrigin = ''
      }
    }
  }, [enabled, scannerRef])

  // CSS transform for initial render / non-gesture state
  // During gestures, DOM is manipulated directly for real-time feedback
  const videoStyle: CSSProperties = isNativeZoom
    ? {}
    : zoomLevel > 1
      ? { transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }
      : {}

  // Dynamic scan region: crop center on iOS for decoder zoom
  const getScanRegion = useCallback((video: HTMLVideoElement): ScanRegion => {
    const z = zoomRef.current
    if (z <= 1 || isNativeZoomRef.current) {
      return {
        x: 0,
        y: 0,
        width: video.videoWidth,
        height: video.videoHeight,
        downScaledWidth: 800,
        downScaledHeight: 800,
      }
    }

    const cropWidth = video.videoWidth / z
    const cropHeight = video.videoHeight / z
    return {
      x: (video.videoWidth - cropWidth) / 2,
      y: (video.videoHeight - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight,
      downScaledWidth: 800,
      downScaledHeight: 800,
    }
  }, [])

  return { zoomLevel, videoStyle, getScanRegion }
}
