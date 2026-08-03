import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  calculateFastScanGuideSize,
  calculateFastScanRegion,
  calculateVisibleScanRegion,
} from '@/ui/lib/qr-scan-region'

describe('calculateVisibleScanRegion', () => {
  it('decodes only source pixels visible through a portrait object-cover viewport', () => {
    expect(calculateVisibleScanRegion(1920, 1080, 330, 412.5, 1, false)).toEqual({
      x: 528,
      y: 0,
      width: 864,
      height: 1080,
    })
  })

  it('crops the visible source region again for CSS zoom', () => {
    expect(calculateVisibleScanRegion(1920, 1080, 330, 412.5, 2, false)).toEqual({
      x: 744,
      y: 270,
      width: 432,
      height: 540,
    })
  })

  it('does not double-crop a stream that uses native camera zoom', () => {
    expect(calculateVisibleScanRegion(1920, 1080, 330, 412.5, 2, true)).toEqual({
      x: 528,
      y: 0,
      width: 864,
      height: 1080,
    })
  })

  it('falls back to the full intrinsic frame before layout has dimensions', () => {
    expect(calculateVisibleScanRegion(1920, 1080, 0, 0, 1, false)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })
})

describe('calculateFastScanGuideSize', () => {
  it('maps a landscape fast square to five-sixths of a 4:5 preview', () => {
    const size = calculateFastScanGuideSize(1920, 1080, 330, 412.5, 1, false)

    expect(size).toBe(275)
    expect(size / 330).toBeCloseTo(5 / 6)
  })

  it('stays aligned when CSS zoom shrinks the source square and scales the video', () => {
    expect(calculateFastScanGuideSize(1920, 1080, 330, 412.5, 2, false)).toBe(275)
  })

  it('stays aligned when native zoom leaves both source and preview scale unchanged', () => {
    expect(calculateFastScanGuideSize(1920, 1080, 330, 412.5, 2, true)).toBe(275)
  })

  it('uses the live stream orientation rather than a fixed preview percentage', () => {
    expect(calculateFastScanGuideSize(1080, 1920, 330, 412.5, 1, false)).toBe(220)
  })
})

describe('calculateFastScanRegion', () => {
  it('exposes fixed downscaled dimensions in its public type', () => {
    const region = calculateFastScanRegion(1920, 1080, 330, 412.5, 1, false)

    expectTypeOf(region.downScaledWidth).toEqualTypeOf<400>()
    expectTypeOf(region.downScaledHeight).toEqualTypeOf<400>()
  })

  it('centers a Cashu-sized source square and downscales it for fast decoding', () => {
    expect(calculateFastScanRegion(1920, 1080, 330, 412.5, 1, false)).toEqual({
      x: 600,
      y: 180,
      width: 720,
      height: 720,
      downScaledWidth: 400,
      downScaledHeight: 400,
    })
  })

  it('reduces the decoder source square for CSS zoom', () => {
    const cssZoom = calculateFastScanRegion(1920, 1080, 330, 412.5, 2, false)

    expect(cssZoom.width).toBe(cssZoom.height)
    expect(cssZoom.width).toBe(360)
  })

  it('does not reduce the decoder source square for native camera zoom', () => {
    const nativeZoom = calculateFastScanRegion(1920, 1080, 330, 412.5, 2, true)

    expect(nativeZoom.width).toBe(720)
    expect(nativeZoom.height).toBe(720)
  })
})
