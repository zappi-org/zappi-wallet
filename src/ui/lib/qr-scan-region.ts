export interface ScanRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface FastScanRegion extends ScanRegion {
  downScaledWidth: 400
  downScaledHeight: 400
}

export const FAST_QR_SIZE = 400 as const

/** Maps the visible object-cover viewport to source-video pixels. */
export function calculateVisibleScanRegion(
  videoWidth: number,
  videoHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  nativeZoom: boolean,
): ScanRegion {
  if (videoWidth <= 0 || videoHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0, width: videoWidth, height: videoHeight }
  }

  const sourceAspect = videoWidth / videoHeight
  const viewportAspect = viewportWidth / viewportHeight
  let visibleWidth = videoWidth
  let visibleHeight = videoHeight

  if (sourceAspect > viewportAspect) {
    visibleWidth = videoHeight * viewportAspect
  } else if (sourceAspect < viewportAspect) {
    visibleHeight = videoWidth / viewportAspect
  }

  const decoderZoom = nativeZoom ? 1 : Math.max(1, zoom)
  const cropWidth = visibleWidth / decoderZoom
  const cropHeight = visibleHeight / decoderZoom

  return {
    x: Math.round((videoWidth - cropWidth) / 2),
    y: Math.round((videoHeight - cropHeight) / 2),
    width: Math.round(cropWidth),
    height: Math.round(cropHeight),
  }
}

export function calculateFastScanRegion(
  videoWidth: number,
  videoHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  nativeZoom: boolean,
): FastScanRegion {
  const visible = calculateVisibleScanRegion(
    videoWidth, videoHeight, viewportWidth, viewportHeight, zoom, nativeZoom,
  )
  const zoomDivisor = nativeZoom ? 1 : Math.max(1, zoom)
  const cashuSide = Math.round((Math.min(videoWidth, videoHeight) * 2) / 3 / zoomDivisor)
  const side = Math.max(1, Math.min(cashuSide, visible.width, visible.height))
  return {
    x: Math.round((videoWidth - side) / 2),
    y: Math.round((videoHeight - side) / 2),
    width: side,
    height: side,
    downScaledWidth: FAST_QR_SIZE,
    downScaledHeight: FAST_QR_SIZE,
  }
}

export function calculateFastScanGuideSize(
  videoWidth: number,
  videoHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  nativeZoom: boolean,
): number {
  if (videoWidth <= 0 || videoHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return 0
  }

  const region = calculateFastScanRegion(
    videoWidth,
    videoHeight,
    viewportWidth,
    viewportHeight,
    zoom,
    nativeZoom,
  )
  const objectCoverScale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight)
  const visualZoom = nativeZoom ? 1 : Math.max(1, zoom)
  return Math.round(region.width * objectCoverScale * visualZoom * 1000) / 1000
}
