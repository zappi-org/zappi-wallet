import { describe, expect, it } from 'vitest'
import {
  isInSystemGestureZone,
  shouldHistoryDrawerStayOpen,
} from '@/ui/components/common/history-drawer-gesture'

describe('history drawer release decision', () => {
  it('closes an expanded drawer after 100px of downward travel', () => {
    expect(shouldHistoryDrawerStayOpen({
      expanded: true,
      travelled: 101,
      velocityY: 0,
    })).toBe(false)
  })

  it('returns an expanded drawer when a short drag is released', () => {
    expect(shouldHistoryDrawerStayOpen({
      expanded: true,
      travelled: 99,
      velocityY: 0,
    })).toBe(true)
  })

  it('uses flick direction before distance', () => {
    expect(shouldHistoryDrawerStayOpen({
      expanded: true,
      travelled: 20,
      velocityY: 501,
    })).toBe(false)
    expect(shouldHistoryDrawerStayOpen({
      expanded: false,
      travelled: 20,
      velocityY: -501,
    })).toBe(true)
  })
})

describe('isInSystemGestureZone', () => {
  it('claims the home-indicator band plus the margin above it', () => {
    // 874 screen, 34px indicator inset: zone starts at 874 - 44 = 830
    expect(isInSystemGestureZone(830, 874, 34)).toBe(true)
    expect(isInSystemGestureZone(873, 874, 34)).toBe(true)
  })

  it('leaves everything above the band to the sheet', () => {
    expect(isInSystemGestureZone(829, 874, 34)).toBe(false)
    expect(isInSystemGestureZone(700, 874, 34)).toBe(false)
  })

  it('shrinks to the margin alone where there is no inset', () => {
    expect(isInSystemGestureZone(863, 874, 0)).toBe(false)
    expect(isInSystemGestureZone(865, 874, 0)).toBe(true)
  })
})
